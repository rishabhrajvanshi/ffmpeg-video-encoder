# 🎬 High-Performance Video Processing & Streaming System

A blazing-fast video encoding and adaptive streaming system built with Node.js, FFmpeg, and MP4Box. Process videos into multiple resolutions and generate DASH/HLS manifests for adaptive bitrate streaming.

## ✨ Features

- **🚀 Hardware Acceleration**: Utilizes `h264_videotoolbox` on macOS for 5x faster encoding
- **⚡ Parallel Processing**: Simultaneous encoding of multiple resolutions 
- **📱 Adaptive Streaming**: Generates DASH (.mpd) and HLS (.m3u8) manifests
- **🎯 Smart Quality Ladder**: Optimized 240p and 720p resolutions for mobile & desktop
- **📊 Real-time Performance Metrics**: Detailed timing for encoding and segmentation
- **🔄 Auto Processing**: Background worker monitors uploads folder
- **🌐 Web Interface**: Built-in adaptive video player with automatic quality selection

## 🏆 Performance Metrics

**Processing Speed**: **5.3x realtime** - Can process ~5.3 hours of video per hour!

| Video Duration | Processing Time | Speed Improvement |
|----------------|----------------|-------------------|
| 13.5 seconds   | 11.78s         | 87% realtime      |
| 170.86 seconds | 32.24s         | **530% realtime** |

### Encoding Performance
- **240p**: 8.44x realtime encoding speed
- **720p**: 5.8x realtime encoding speed
- **CPU Utilization**: 425% (excellent multi-core usage)

## 🛠️ Installation

### Prerequisites
- Node.js 14+ 
- FFmpeg with hardware acceleration support
- MP4Box (GPAC)

### Install Dependencies
```bash
# Install Node.js dependencies
npm install

# Install system dependencies (macOS)
brew install mp4box

# Build the project
npm run build
```

### Dependencies Overview
```json
{
  "ffmpeg-static": "Static FFmpeg binaries",
  "fluent-ffmpeg": "FFmpeg wrapper with fluent API", 
  "mp4box": "MP4Box Node.js wrapper",
  "express": "Web server framework",
  "multer": "File upload middleware"
}
```

## 🚀 Usage

### Start the Services
```bash
# Start upload server (port 3000)
npm start

# Start video processing worker (in another terminal)
npm run start:worker
```

### Web Interface
Open `http://localhost:3000` to access the adaptive video player interface.

### API Endpoints

#### Upload Video
```bash
POST /upload
Content-Type: multipart/form-data
Field: video (file)

curl -X POST -F "video=@your-video.mp4" http://localhost:3000/upload
```

#### Health Check
```bash
GET /health
# Returns: "ok"
```

#### Serve Processed Videos
```bash
GET /public/{video-id}/manifest.mpd   # DASH manifest
GET /public/{video-id}/manifest.m3u8  # HLS manifest
GET /public/{video-id}/*              # Video segments
```

## 🔧 Technical Architecture

### Quality Ladder
| Resolution | Bitrate | Use Case |
|------------|---------|----------|
| 240p       | 400k    | Mobile, slow connections |
| 720p       | 2000k   | Desktop, good connections |

### Processing Pipeline
1. **Upload** → Video saved to `uploads/` directory
2. **Detection** → Worker scans for new `.mp4` files
3. **Parallel Encoding** → FFmpeg encodes both resolutions simultaneously
4. **Segmentation** → MP4Box creates DASH + HLS segments in parallel
5. **Cleanup** → Original progressive MP4s deleted, segments retained

### Hardware Optimization
- **macOS**: `h264_videotoolbox` hardware encoder
- **Linux/Windows**: Falls back to optimized `libx264`
- **Preset**: `veryfast` for optimal speed/quality balance

## 📁 Project Structure

```
ffmpeg/
├── src/
│   ├── server.ts          # Express server + upload handling
│   └── worker.ts          # Video processing worker
├── public/                # Processed videos output
│   └── {video-id}/       # Individual video folders
│       ├── manifest.mpd  # DASH manifest
│       ├── manifest.m3u8 # HLS manifest
│       └── *.m4s         # Video/audio segments
├── uploads/              # Upload directory
├── player.html          # Adaptive video player
├── package.json
├── tsconfig.json
└── README.md
```

## 🎮 Adaptive Video Player

The included HTML player automatically:
- **Detects connection speed** and selects appropriate quality
- **Switches quality** based on network conditions
- **Provides manual quality control** for user preference
- **Supports both DASH and HLS** (HLS.js fallback)

### Player Features
- Responsive design for mobile and desktop
- Quality indicator and manual selection
- Connection speed detection
- Smooth quality transitions

## ⚙️ Configuration

### Customize Quality Ladder
Edit `src/worker.ts`:
```typescript
const LADDER = [
  { name: "360p", scale: "scale=-2:640", bitrate: "700k" },
  { name: "720p", scale: "scale=-2:1280", bitrate: "2000k" },
  { name: "1080p", scale: "scale=-2:1920", bitrate: "4500k" }
];
```

### Adjust Segment Duration
```typescript
// In generateCmafAndManifests function
const dashArgs = ["-dash", "4000"]; // 4-second segments
```

### Hardware Encoder Selection
```typescript
// In encodeBaseline function
"-c:v", "h264_videotoolbox",  // macOS
"-c:v", "h264_nvenc",         // NVIDIA GPU
"-c:v", "h264_vaapi",         // Intel GPU (Linux)
```

## 📊 Monitoring & Logging

The system provides detailed timing information:
```
Timing: encoding=29.74s, segmentation=2.51s, total=32.24s
```

Monitor processing with:
```bash
# Watch worker logs
npm run start:worker

# Check processed videos
ls -la public/
```

## 🔍 Troubleshooting

### Common Issues

**Slow Processing**:
- Verify hardware acceleration is working
- Check CPU usage during processing
- Ensure sufficient disk space

**Upload Failures**:
- Check file size limits (default: no limit)
- Verify supported video formats
- Monitor server logs

**Playback Issues**:
- Ensure manifests are generated correctly
- Check CORS headers if serving from different domain
- Verify HLS.js is loaded for Safari compatibility

## 🚀 Production Deployment

### Recommended Setup
- Use PM2 for process management
- Set up reverse proxy (nginx)
- Configure proper CORS headers
- Implement authentication for uploads
- Set up CDN for video delivery

### Environment Variables
```bash
PORT=3000                    # Server port
UPLOAD_DIR=./uploads        # Upload directory
PUBLIC_DIR=./public         # Output directory
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [FFmpeg](https://ffmpeg.org/) - The powerhouse behind video processing
- [MP4Box/GPAC](https://gpac.wp.imt.fr/) - DASH/HLS segmentation
- [HLS.js](https://github.com/video-dev/hls.js/) - HLS playback support

---

**Built with ⚡ for maximum performance and 💝 for great user experience** 