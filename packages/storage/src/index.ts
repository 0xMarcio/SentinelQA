import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface UploadedArtifact {
  key: string;
  bucket: string;
  url: string;
  contentType: string;
  sizeBytes?: number;
}

export function storageConfigFromEnv(): StorageConfig {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9100",
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "sentinelqa-artifacts",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "sentinelqa",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "sentinelqa-secret",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true"
  };
}

export class ArtifactStorage {
  readonly client: S3Client;
  readonly config: StorageConfig;

  constructor(config: StorageConfig = storageConfigFromEnv()) {
    this.config = config;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }

  async putBuffer(key: string, body: Buffer | Uint8Array, contentType: string): Promise<UploadedArtifact> {
    await this.ensureBucket();
    const input: PutObjectCommandInput = {
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    };
    await this.client.send(new PutObjectCommand(input));
    return {
      key,
      bucket: this.config.bucket,
      contentType,
      sizeBytes: body.byteLength,
      url: await this.getPresignedUrl(key)
    };
  }

  async putJson(key: string, value: unknown): Promise<UploadedArtifact> {
    return this.putBuffer(key, Buffer.from(JSON.stringify(value, null, 2)), "application/json");
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<UploadedArtifact> {
    await this.ensureBucket();
    const fileStat = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType
      })
    );
    return {
      key,
      bucket: this.config.bucket,
      contentType,
      sizeBytes: fileStat.size,
      url: await this.getPresignedUrl(key)
    };
  }

  async getPresignedUrl(key: string, expiresIn = 60 * 60 * 24): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) {
      return Buffer.alloc(0);
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

export function artifactKey(runId: string, kind: string, filename: string): string {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  return `runs/${runId}/${kind}/${Date.now()}-${safeName}`;
}
