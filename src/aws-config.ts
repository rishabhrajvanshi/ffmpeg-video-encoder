import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv";

dotenv.config();

// AWS Configuration
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// S3 Configuration
export const S3_BUCKET = process.env.S3_BUCKET;
export const S3_INPUT_PREFIX = "uploads/";
export const S3_OUTPUT_PREFIX = "processed/";

// SQS Configuration
export const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;

// Create AWS clients
const awsConfig = {
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID!,
    secretAccessKey: AWS_SECRET_ACCESS_KEY!
  }
};

export const s3Client = new S3Client(awsConfig);
export const sqsClient = new SQSClient(awsConfig);

// Message types
export interface VideoProcessingMessage {
  s3Key: string;
  postId: string;
  filename: string;
  uploadId: string;
  timestamp: number;
  hasAudio: boolean;
  userId: string;
}
