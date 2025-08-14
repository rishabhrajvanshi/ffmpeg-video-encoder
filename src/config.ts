export interface EncodingConfig {
  // Encoding settings
  useGPU: boolean;
  cpuThreads: number;
  preset: string;
  tune: string;
  crf: number;
  
  // Memory and performance
  maxMemory: string;
  bufferSize: string;
  
  // Parallel processing
  maxConcurrentEncodings: number;
  
  // Quality settings
  enableTwoPass: boolean;
  enableFastStart: boolean;
  
  // Advanced settings
  keyframeInterval: number;
  bframes: number;
  refFrames: number;
}

export const DEFAULT_CONFIG: EncodingConfig = {
  // Encoding settings
  useGPU: true,           // Try to use GPU acceleration
  cpuThreads: 0,          // 0 = use all available threads
  preset: 'ultrafast',    // Encoding preset: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  tune: 'zerolatency',    // Tune for zero latency (faster encoding)
  crf: 28,                // Constant Rate Factor (18-28 is good, lower = better quality, higher = faster)
  
  // Memory and performance
  maxMemory: '2G',        // Maximum memory usage
  bufferSize: '32M',      // Input buffer size
  
  // Parallel processing
  maxConcurrentEncodings: 2, // Maximum concurrent encoding jobs
  
  // Quality settings
  enableTwoPass: false,   // Enable two-pass encoding for better quality (slower)
  enableFastStart: true,  // Enable fast start for web streaming
  
  // Advanced settings
  keyframeInterval: 120,  // Keyframe interval (4 seconds at 30fps)
  bframes: 1,             // Number of B-frames (reduced for speed)
  refFrames: 1,           // Number of reference frames (reduced for speed)
};

// Resolution ladder configuration
export interface ResolutionRung {
  name: string;
  scale: string;
  bitrate: string;
  crf: number;
  enabled: boolean;
}

export const DEFAULT_LADDER: ResolutionRung[] = [
  { 
    name: "240p", 
    scale: "scale=-2:426", 
    bitrate: "400k",
    crf: 30,  // Higher CRF for faster encoding
    enabled: true
  },
  { 
    name: "720p", 
    scale: "scale=-2:1280", 
    bitrate: "2000k",
    crf: 28,  // Higher CRF for faster encoding
    enabled: true
  },
  { 
    name: "1080p", 
    scale: "scale=-2:1920", 
    bitrate: "4000k",
    crf: 26,  // Higher CRF for faster encoding
    enabled: false  // Disabled by default for faster processing
  }
];

// Environment-specific overrides
export function getConfig(): EncodingConfig {
  const env = process.env.NODE_ENV || 'development';
  // Optional override for max concurrent encodings via env var
  const parsed = parseInt(process.env.MAX_CONCURRENCY ?? '', 10);
  const envMaxConcurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

  // Additional environment overrides for quick tuning
  const envUseGpu = typeof process.env.USE_GPU === 'string'
    ? /^(1|true|yes)$/i.test(process.env.USE_GPU)
    : undefined;
  const envPreset = process.env.PRESET && process.env.PRESET.trim().length > 0
    ? process.env.PRESET.trim()
    : undefined;
  const envTune = process.env.TUNE && process.env.TUNE.trim().length > 0
    ? process.env.TUNE.trim()
    : undefined;
  const envCrfParsed = parseInt(process.env.CRF ?? '', 10);
  const envCrf = Number.isFinite(envCrfParsed) ? envCrfParsed : undefined;
  const envCpuThreadsParsed = parseInt(process.env.CPU_THREADS ?? '', 10);
  const envCpuThreads = Number.isFinite(envCpuThreadsParsed) && envCpuThreadsParsed >= 0
    ? envCpuThreadsParsed
    : undefined;
  
  if (env === 'production') {
    return {
      ...DEFAULT_CONFIG,
      useGPU: envUseGpu ?? true,
      maxConcurrentEncodings: envMaxConcurrency ?? 4,
      preset: envPreset ?? 'fast',  // Better quality in production
      tune: envTune ?? DEFAULT_CONFIG.tune,
      crf: envCrf ?? 20,
      cpuThreads: envCpuThreads ?? DEFAULT_CONFIG.cpuThreads
    };
  }
  
  if (env === 'development') {
    return {
      ...DEFAULT_CONFIG,
      useGPU: envUseGpu ?? false,  // Disable GPU in development to avoid conflicts
      maxConcurrentEncodings: envMaxConcurrency ?? 4, // Allow parallel processing in development
      preset: envPreset ?? 'ultrafast',  // Fastest encoding for development
      tune: envTune ?? 'zerolatency',  // Optimize for speed
      crf: envCrf ?? 30,  // Highest CRF for fastest encoding
      cpuThreads: envCpuThreads ?? DEFAULT_CONFIG.cpuThreads,
      bframes: 0,  // Disable B-frames for maximum speed
      refFrames: 1,  // Minimum reference frames
      keyframeInterval: 120  // 4 second segments (at 30fps)
    };
  }
  
  return DEFAULT_CONFIG;
}

export function getLadder(): ResolutionRung[] {
  const env = process.env.NODE_ENV || 'development';
  
  if (env === 'production') {
    return DEFAULT_LADDER.map(rung => ({
      ...rung,
      enabled: true  // Enable all resolutions in production
    }));
  }
  
  return DEFAULT_LADDER.filter(rung => rung.enabled);
}
