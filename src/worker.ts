import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { getConfig, getLadder, type ResolutionRung } from "./config";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const OUTPUT_DIR = path.resolve(process.cwd(), "public");

// Optionally set custom ffmpeg binary (enables system builds with GPU support)
try {
  const userSpecified = process.env.FFMPEG_PATH;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const staticFallback = (() => { try { return require("ffmpeg-static") as string; } catch { return null; } })();
  const chosen = userSpecified || staticFallback;
  if (chosen) {
    ffmpeg.setFfmpegPath(chosen);
  }
} catch {}

// Get configuration and resolution ladder
const CONFIG = getConfig();
const LADDER = getLadder().filter(rung => rung.enabled);

console.log(`🚀 Starting encoder with config:`, {
  useGPU: CONFIG.useGPU,
  preset: CONFIG.preset,
  maxConcurrentEncodings: CONFIG.maxConcurrentEncodings,
  enabledResolutions: LADDER.map(r => r.name)
});

// Semaphore for limiting concurrent encodings
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

const encodingSemaphore = new Semaphore(CONFIG.maxConcurrentEncodings);

async function encodeResolution(
  rung: ResolutionRung,
  inputPath: string,
  workDir: string
): Promise<string> {
  const outFile = path.join(workDir, `${rung.name}.mp4`);
  
  // Acquire semaphore permit before starting encoding
  await encodingSemaphore.acquire();
  
  try {
    return await new Promise<string>((resolve, reject) => {
      console.log(`🎬 Encoding ${rung.name} for ${path.basename(inputPath)} ...`);
      
      let command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .videoFilters(rung.scale)
        .videoBitrate(rung.bitrate)
        .outputOptions([
          '-profile:v', 'high',
          '-g', CONFIG.keyframeInterval.toString(),
          '-keyint_min', CONFIG.keyframeInterval.toString(),
          '-sc_threshold', '0',
          '-bf', CONFIG.bframes.toString(),
          '-refs', CONFIG.refFrames.toString(),
          '-preset', CONFIG.preset,
          '-tune', CONFIG.tune,
          '-crf', rung.crf.toString(),
          '-threads', CONFIG.cpuThreads.toString(),
          '-max_muxing_queue_size', '1024',
          '-bufsize', CONFIG.bufferSize
        ])
        .audioCodec('aac')
        .audioBitrate('128k');
      
      // Add fast start flag if enabled
      if (CONFIG.enableFastStart) {
        command = command.outputOptions(['-movflags', 'faststart']);
      }
      
      // Try to use GPU acceleration if available and enabled
      if (CONFIG.useGPU) {
        // Check for NVIDIA GPU support
        try {
          command = command.videoCodec('h264_nvenc');
          console.log(`🚀 Using NVIDIA GPU acceleration for ${rung.name}`);
        } catch (e) {
          // Try Intel Quick Sync
          try {
            command = command.videoCodec('h264_qsv');
            console.log(`🚀 Using Intel Quick Sync for ${rung.name}`);
          } catch (e2) {
            // Fallback to CPU encoding
            console.log(`💻 Using CPU encoding for ${rung.name}`);
          }
        }
      } else {
        console.log(`💻 Using CPU encoding for ${rung.name}`);
      }
      
      command
        .output(outFile)
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`📊 ${rung.name}: ${progress.percent.toFixed(1)}% complete`);
          }
        })
        .on('end', () => {
          console.log(`✅ Finished ${rung.name} for ${path.basename(inputPath)}`);
          resolve(outFile);
        })
        .on('error', (err) => {
          console.error(`❌ Error encoding ${rung.name}:`, err);
          reject(err);
        })
        .run();
    });
  } finally {
    // Always release the semaphore permit
    encodingSemaphore.release();
  }
}

async function generateCmafAndManifest(outputs: string[], manifestDir: string) {
  console.log("📦 Generating DASH/HLS manifests...");
  fs.mkdirSync(manifestDir, { recursive: true });

  // For now, we'll use the existing MP4Box approach since fluent-ffmpeg doesn't directly support DASH/HLS manifest generation
  // You could also consider using other packages like @ffmpeg-installer/ffmpeg with spawn for manifest generation
  const { spawn } = require("child_process");
  const manifestMode = (process.env.MANIFESTS || "both").toLowerCase(); // both | dash | hls | none
  
  if (manifestMode === "both" || manifestMode === "dash") {
    const dashArgs = [
      "-dash", "4000", "-rap", "-frag-rap",
      "-profile", "dashavc264:live",
      "-out", path.join(manifestDir, "manifest.mpd"),
      ...outputs.flatMap(f => [`${f}#video`, `${f}#audio`])
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn("MP4Box", dashArgs, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`MP4Box exited with code ${code}`));
      });
    });
  }

  if (manifestMode === "both" || manifestMode === "hls") {
    const hlsArgs = [
      "-dash", "4000", "-rap", "-frag-rap",
      "-profile", "live",
      "-out", path.join(manifestDir, "manifest.m3u8"),
      ...outputs.flatMap(f => [`${f}#video`, `${f}#audio`])
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn("MP4Box", hlsArgs, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`MP4Box exited with code ${code}`));
      });
    });
  }

  // Clean up the intermediate MP4s
  for (const f of outputs) {
    try { fs.unlinkSync(f); } catch {}
  }
}

async function processUploadsOnce() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.toLowerCase().endsWith(".mp4"));

  await Promise.all(files.map(async (file) => {
    const id = path.parse(file).name;
    const workDir = path.join(OUTPUT_DIR, id);
    const manifestPath = path.join(workDir, "manifest.mpd");
    const lockPath = path.join(workDir, ".processing.lock");

    if (fs.existsSync(manifestPath)) {
      console.log(`⏭️ Skipping ${file} (already processed)`);
      return;
    }

    fs.mkdirSync(workDir, { recursive: true });
    // Cross-process lock to avoid duplicate work when multiple workers run
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    } catch (err: any) {
      if (err && err.code === "EEXIST") {
        console.log(`🔒 Skipping ${file} (another worker is processing)`);
        return;
      }
      throw err;
    }
    const inputPath = path.join(UPLOAD_DIR, file);

    try {
      console.log(`🚀 Processing ${file}`);
      const tStart = Date.now();

      // Encode both resolutions in parallel with better error handling
      const outputs = await Promise.allSettled(
        LADDER.map(rung => encodeResolution(rung, inputPath, workDir))
      );

      // Check if any encoding failed
      const failedEncodings = outputs.filter(result => result.status === 'rejected');
      if (failedEncodings.length > 0) {
        console.error(`❌ ${failedEncodings.length} encoding(s) failed for ${file}`);
        failedEncodings.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`  - ${LADDER[index].name}: ${result.reason}`);
          }
        });
        return;
      }

      const successfulOutputs = outputs.map(result => 
        result.status === 'fulfilled' ? result.value : null
      ).filter(Boolean) as string[];

      const tAfterEncode = Date.now();

      // Generate manifests once
      await generateCmafAndManifest(successfulOutputs, workDir);
      const tAfterSegment = Date.now();

      const encodingSeconds = ((tAfterEncode - tStart) / 1000).toFixed(2);
      const segmentationSeconds = ((tAfterSegment - tAfterEncode) / 1000).toFixed(2);
      const totalSeconds = ((tAfterSegment - tStart) / 1000).toFixed(2);

      console.log(`⏱ Timing: encoding=${encodingSeconds}s, segmentation=${segmentationSeconds}s, total=${totalSeconds}s`);
      console.log(`✅ Finished ${file} in ${totalSeconds}s`);
    } catch (err) {
      console.error(`❌ Error processing ${file}:`, err);
    } finally {
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }));
}

async function loop() {
  while (true) {
    await processUploadsOnce();
    await new Promise(r => setTimeout(r, 4000));
  }
}

if (require.main === module) {
  loop().catch(err => {
    console.error("Worker crashed:", err);
    process.exit(1);
  });
}
