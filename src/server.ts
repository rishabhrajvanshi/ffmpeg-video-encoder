import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

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
const upload = multer({ storage });

const app = express();

// Static serve processed output via /public
app.use("/public", express.static(PUBLIC_DIR));

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

app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded (field name: video)" });
  }
  // Return id (filename without ext) so client can poll or request status
  const id = path.parse(req.file.filename).name;
  return res.json({
    message: "Upload received",
    id,
    originalName: req.file.originalname,
    uploadedPath: req.file.path
  });
});

app.get("/health", (_, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Upload server listening on http://localhost:${PORT}`);
  console.log(`POST /upload (form field 'video')`);
});