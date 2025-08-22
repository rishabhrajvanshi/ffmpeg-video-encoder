import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { s3Client, sqsClient, S3_BUCKET, S3_INPUT_PREFIX, S3_OUTPUT_PREFIX, SQS_QUEUE_URL } from "./aws-config";
import { Readable } from "stream";
import type { VideoProcessingMessage } from "./aws-config";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Use UUID + original extension
    const id = uuidv4();
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({ 
  storage,
  // Allow multiple files with field name 'video'
  limits: {
    files: 10 // Maximum 10 files per request
  }
});

const app = express();

// Serve processed files from S3
// app.get("/public/:uploadId/*", async (req, res) => {
//   try {
//     const uploadId = req.params.uploadId;
//     const filePath = req.params[0];
//     const s3Key = `${S3_OUTPUT_PREFIX}${uploadId}/${filePath}`;

//     const s3Response = await s3Client.send(new GetObjectCommand({
//       Bucket: S3_BUCKET,
//       Key: s3Key
//     }));

//     // Set appropriate headers
//     if (s3Response.ContentType) {
//       res.setHeader('Content-Type', s3Response.ContentType);
//     }
//     if (s3Response.ContentLength) {
//       res.setHeader('Content-Length', s3Response.ContentLength);
//     }

//     // Stream the file from S3 to the response
//     (s3Response.Body as Readable).pipe(res);
//   } catch (err) {
//     console.error(`Failed to serve file: ${req.path}`, err);
//     res.status(404).json({ error: "File not found" });
//   }
// });

// Serve the player HTML file
app.get("/", (req, res) => {
  res.sendFile(path.resolve(process.cwd(), "player.html"));
});

// List available manifests in public directory
app.get("/manifests", (req, res) => {
  try {
    const items: Array<{ id: string; hls?: string; dash?: string }> = [];

    const entries = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = path.join(PUBLIC_DIR, id);
      const hlsPath = path.join(dir, "manifest.m3u8");
      const dashPath = path.join(dir, "manifest.mpd");
      const item: { id: string; hls?: string; dash?: string } = { id };
      if (fs.existsSync(hlsPath)) item.hls = `/public/${id}/manifest.m3u8`;
      if (fs.existsSync(dashPath)) item.dash = `/public/${id}/manifest.mpd`;
      if (item.hls || item.dash) items.push(item);
    }

    res.json({ items });
  } catch (err) {
    console.error("/manifests error", err);
    res.status(500).json({ error: "Failed to list manifests" });
  }
});

app.post("/upload", upload.array("video"), async (req, res) => {
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded (field name: video)" });
  }
  
  try {
    // Process all uploaded files
    const results = await Promise.all(req.files.map(async (file) => {
      try {
        const uploadId = uuidv4();
        const s3Key = `${S3_INPUT_PREFIX}${uploadId}${path.extname(file.originalname)}`;
        
        // Upload file to S3
        await s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: fs.createReadStream(file.path),
          ContentType: file.mimetype
        }));

        // Create SQS message
        const message: VideoProcessingMessage = {
          s3Key,
          filename: file.originalname,
          uploadId,
          timestamp: Date.now(),
          hasAudio: false,
        };

        // Send message to SQS
        await sqsClient.send(new SendMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MessageBody: JSON.stringify(message)
        }));

        // Clean up local file
        fs.unlinkSync(file.path);
        
        return {
          uploadId,
          s3Key,
          originalName: file.originalname,
          status: "queued"
        };
      } catch (err) {
        console.error(`Failed to process upload for ${file.originalname}:`, err);
        // Clean up local file on error
        try { fs.unlinkSync(file.path); } catch {}
        return {
          originalName: file.originalname,
          status: "failed",
          error: "Failed to process upload"
        };
      }
    }));

    return res.json({
      message: `${results.length} video(s) uploaded and queued for processing`,
      videos: results
    });
  } catch (err) {
    console.error("Failed to handle video uploads:", err);
    return res.status(500).json({ error: "Failed to handle video uploads" });
  }
});

// Add status endpoint
app.get("/status/:uploadId", async (req, res) => {
  try {
    const uploadId = req.params.uploadId;
    const manifestKey = `${S3_OUTPUT_PREFIX}${uploadId}/manifest.mpd`;
    
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: manifestKey
      }));
      res.json({ status: "completed", manifestUrl: `/public/${uploadId}/manifest.mpd` });
    } catch {
      res.json({ status: "processing" });
    }
  } catch (err) {
    console.error("Failed to get status:", err);
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.get("/health", (_, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Upload server listening on http://localhost:${PORT}`);
  console.log(`POST /upload (form field 'video')`);
});