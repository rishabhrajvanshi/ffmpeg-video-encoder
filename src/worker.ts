import fs from "fs";
import path from "path";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import ffmpeg from "fluent-ffmpeg";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { s3Client, sqsClient, S3_BUCKET, S3_INPUT_PREFIX, S3_OUTPUT_PREFIX, SQS_QUEUE_URL } from "./aws-config";
import type { VideoProcessingMessage } from "./aws-config";
import { getConfig, getLadder, type ResolutionRung } from "./config";
import { Readable, PassThrough } from "stream";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const OUTPUT_DIR = path.resolve(process.cwd(), "public");

// Get configuration and resolution ladder
const CONFIG = getConfig();
const LADDER = getLadder().filter(rung => rung.enabled);

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
  s3Response: any,
  message: VideoProcessingMessage,
  workDir: string
): Promise<string> {
  const outFile = path.join(workDir, `${rung.name}.mp4`);
  
  // Create a temporary input file for more reliable processing
  const tempInputPath = path.join(workDir, '_input.mp4');
  const writeStream = fs.createWriteStream(tempInputPath);
  await new Promise<void>((resolveWrite, rejectWrite) => {
    (s3Response.Body as Readable)
      .pipe(writeStream)
      .on('finish', resolveWrite)
      .on('error', rejectWrite);
  });

  console.log(`🎬 Encoding ${rung.name} for ${message.filename} ...`);
  
  return await new Promise<string>((resolve, reject) => {

    let command = ffmpeg(tempInputPath)
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
        // Clean up temporary input file
        try { fs.unlinkSync(tempInputPath); } catch {}
        console.log(`✅ Finished ${rung.name} for ${message.filename}`);
        resolve(outFile);
      })
      .on('error', (err) => {
        console.error(`❌ Error encoding ${rung.name}:`, err);
        reject(err);
      })
      .run();
  });
}

async function generateCmafAndManifest(outputs: string[], manifestDir: string) {
  console.log("📦 Generating DASH/HLS manifests...");
  fs.mkdirSync(manifestDir, { recursive: true });

  const { spawn } = require("child_process");
  const manifestMode = (process.env.MANIFESTS || "both").toLowerCase();
  
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

async function processVideo(message: VideoProcessingMessage) {
  // Acquire semaphore permit before starting video processing
  await encodingSemaphore.acquire();
  
  // Create temporary directory only for outputs
  const tempDir = path.join(UPLOAD_DIR, message.uploadId);
  const workDir = path.join(tempDir, 'output');
  fs.mkdirSync(workDir, { recursive: true });
  
  try {
    // Get S3 input stream
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: message.s3Key
    }));
    fs.mkdirSync(workDir, { recursive: true });

    console.log(`🚀 Processing ${message.filename}`);
    const tStart = Date.now();

    // Encode all resolutions in parallel with better error handling
    const outputs = await Promise.allSettled(
      LADDER.map(rung => encodeResolution(rung, s3Response, message, workDir))
    );

    // Check if any encoding failed
    const failedEncodings = outputs.filter(result => result.status === 'rejected');
    if (failedEncodings.length > 0) {
      console.error(`❌ ${failedEncodings.length} encoding(s) failed for ${message.filename}`);
      failedEncodings.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`  - ${LADDER[index].name}: ${result.reason}`);
        }
      });
      throw new Error("Some encodings failed");
    }

    const successfulOutputs = outputs.map(result => 
      result.status === 'fulfilled' ? result.value : null
    ).filter(Boolean) as string[];

    const tAfterEncode = Date.now();

    // Generate manifests
    await generateCmafAndManifest(successfulOutputs, workDir);
    const tAfterSegment = Date.now();

    // Upload all processed files to S3
    const uploadDirectory = async (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
          await uploadDirectory(filePath);
        } else {
          const relativePath = path.relative(workDir, filePath);
          const s3Key = `${S3_OUTPUT_PREFIX}${message.uploadId}/${relativePath}`;
          const contentType = file.endsWith('.mpd') ? 'application/dash+xml' 
            : file.endsWith('.m3u8') ? 'application/x-mpegURL'
            : file.endsWith('.m4s') ? 'video/iso.segment'
            : file.endsWith('.mp4') ? 'video/mp4'
            : 'application/octet-stream';

          await s3Client.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: fs.createReadStream(filePath),
            ContentType: contentType
          }));
          console.log(`Uploaded ${relativePath} to S3`);
        }
      }
    };

    await uploadDirectory(workDir);

    const encodingSeconds = ((tAfterEncode - tStart) / 1000).toFixed(2);
    const segmentationSeconds = ((tAfterSegment - tAfterEncode) / 1000).toFixed(2);
    const totalSeconds = ((tAfterSegment - tStart) / 1000).toFixed(2);

    console.log(`⏱ Timing: encoding=${encodingSeconds}s, segmentation=${segmentationSeconds}s, total=${totalSeconds}s`);
    console.log(`✅ Finished ${message.filename} in ${totalSeconds}s`);
  } catch (err) {
    console.error(`❌ Error processing ${message.filename}:`, err);
    throw err;
  } finally {
    // Clean up temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    // Release the semaphore
    encodingSemaphore.release();
  }
}

// Main worker loop
async function pollMessages() {
  while (true) {
    try {
      // Receive message from SQS
      const response = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20 // Long polling
      }));

      if (!response.Messages || response.Messages.length === 0) {
        continue;
      }

      for (const sqsMessage of response.Messages) {
        try {
          if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) continue;

          const message: VideoProcessingMessage = JSON.parse(sqsMessage.Body);
          console.log(`📥 Received message for ${message.filename}`);

          // Process the video
          await processVideo(message);

          // Delete message after successful processing
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            ReceiptHandle: sqsMessage.ReceiptHandle
          }));

          console.log(`✅ Successfully processed ${message.filename}`);
        } catch (err) {
          console.error(`❌ Failed to process message:`, err);
          // Message will return to queue after visibility timeout
        }
      }
    } catch (err) {
      console.error("Error polling SQS:", err);
      // Wait before retrying on error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Keep the process running
process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  process.exit(0);
});

if (require.main === module) {
  console.log(`🎬 Video processing worker started with concurrency=${CONFIG.maxConcurrentEncodings}`);
  pollMessages().catch(err => {
    console.error("Worker crashed:", err);
    process.exit(1);
  });
}