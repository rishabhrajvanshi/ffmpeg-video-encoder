import { Queue } from "bullmq";
import IORedis from "ioredis";
import path from "path";

const connection = new IORedis();
const videoQueue = new Queue("video-processing", { connection });

// Example: enqueue all files in uploads folder
import fs from "fs";
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

(async () => {
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith(".mp4"));
  for (const file of files) {
    await videoQueue.add("process", { file });
    console.log(`📥 Enqueued ${file}`);
  }
  process.exit(0);
})();
