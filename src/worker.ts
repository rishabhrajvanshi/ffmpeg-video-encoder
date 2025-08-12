import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import ffmpegStatic from "ffmpeg-static";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const OUTPUT_DIR = path.resolve(process.cwd(), "public");

// Only 2 rungs in ladder for better performance
const LADDER = [
  { name: "240p", scale: "scale=-2:426", bitrate: "400k" },
  { name: "720p", scale: "scale=-2:1280", bitrate: "2000k" }
];

function runCmd(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", cwd: cwd ?? process.cwd() });
    p.on("error", (err) => reject(err));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function encodeBaseline(inputPath: string, workDir: string): Promise<string[]> {
  console.log("Starting parallel encoding for all resolutions...");
  
  // Create encoding promises for all resolutions simultaneously
  const encodingPromises = LADDER.map(async (rung) => {
    const outFile = path.join(workDir, `${rung.name}.mp4`);
    const args = [
      "-y",
      "-i", inputPath,
      "-vf", rung.scale,
      "-c:v", "h264_videotoolbox", // change to h264_nvenc for NVidia GPU
      "-preset", "fast",
      "-b:v", rung.bitrate,
      "-profile:v", "high",
      "-keyint_min", "48", "-g", "48", "-sc_threshold", "0",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "faststart",
      outFile
    ];
    console.log(`Encoding ${path.basename(outFile)} ...`);
    await runCmd(ffmpegStatic!, args);
    console.log(`Completed ${path.basename(outFile)}`);
    return outFile;
  });

  // Wait for all encoding processes to complete simultaneously
  const outputs = await Promise.all(encodingPromises);
  console.log("All parallel encoding completed!");
  return outputs;
}

async function generateCmafAndManifests(outputs: string[], manifestDir: string) {
  fs.mkdirSync(manifestDir, { recursive: true });

  // DASH
  const dashArgs = [
    "-dash", "4000",
    "-rap",
    "-frag-rap",
    "-profile", "dashavc264:live",
    "-out", path.join(manifestDir, "manifest.mpd")
  ];
  for (const f of outputs) {
    dashArgs.push(`${f}#video`);
    dashArgs.push(`${f}#audio`);
  }
  console.log("Generating DASH with MP4Box...");
  await runCmd("MP4Box", dashArgs);

  // HLS
  const hlsArgs = [
    "-dash", "4000",
    "-rap",
    "-frag-rap",
    "-profile", "live",
    "-out", path.join(manifestDir, "manifest.m3u8")
  ];
  for (const f of outputs) {
    hlsArgs.push(`${f}#video`);
    hlsArgs.push(`${f}#audio`);
  }
  console.log("Generating HLS with MP4Box...");
  await runCmd("MP4Box", hlsArgs);

  // Delete original progressive MP4s (keep only CMAF fMP4 segments + manifests)
  for (const f of outputs) {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      console.warn(`Could not delete ${f}`, e);
    }
  }
}

async function processUploadsOnce() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.toLowerCase().endsWith(".mp4"));
  for (const file of files) {
    const id = path.parse(file).name;
    const workDir = path.join(OUTPUT_DIR, id);

    if (fs.existsSync(path.join(workDir, "manifest.mpd"))) {
      console.log(`Skipping ${file} (already processed)`);
      continue;
    }

    fs.mkdirSync(workDir, { recursive: true });
    const inputPath = path.join(UPLOAD_DIR, file);

    try {
      console.log(`Processing ${file} -> ${workDir}`);
      const tStart = Date.now();
      const outputs = await encodeBaseline(inputPath, workDir);
      const tAfterEncode = Date.now();
      await generateCmafAndManifests(outputs, workDir);
      const tAfterSegment = Date.now();

      const encodingSeconds = ((tAfterEncode - tStart) / 1000).toFixed(2);
      const segmentationSeconds = ((tAfterSegment - tAfterEncode) / 1000).toFixed(2);
      const totalSeconds = ((tAfterSegment - tStart) / 1000).toFixed(2);

      console.log(`Timing: encoding=${encodingSeconds}s, segmentation=${segmentationSeconds}s, total=${totalSeconds}s`);
      console.log(`Completed processing ${file}`);
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }
}

async function loop() {
  while (true) {
    try {
      await processUploadsOnce();
    } catch (err) {
      console.error("Worker error:", err);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

if (require.main === module) {
  loop().catch(err => {
    console.error("Worker crashed:", err);
    process.exit(1);
  });
}