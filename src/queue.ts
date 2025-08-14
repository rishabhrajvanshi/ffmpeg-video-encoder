import { Queue, Job } from "bullmq";
import IORedis from "ioredis";

// Create Redis connection with required BullMQ options
const connection = new IORedis({
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Create video processing queue
export const videoQueue = new Queue("video-processing", { connection });

// Export job status types
export type JobStatus = "waiting" | "active" | "completed" | "failed";

// Get job status
export async function getJobStatus(jobId: string): Promise<{ status: JobStatus; progress?: number }> {
  const job = await videoQueue.getJob(jobId);
  if (!job) {
    throw new Error("Job not found");
  }
  
  return {
    status: job.status as JobStatus,
    progress: job.progress as number | undefined
  };
}

// Add a new video processing job
export async function addVideoJob(filename: string): Promise<string> {
  const job = await videoQueue.add("process", { filename });
  return job.id!;
}
