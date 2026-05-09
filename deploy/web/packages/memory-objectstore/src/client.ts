/**
 * S3-compatible episodic truth-layer client.
 *
 * The object store is the immutable ground-truth archive. It is write-once:
 * objects are never overwritten after creation. Only metadata in OpenSearch
 * is updated to reflect retrieval priority changes, decay, and consolidation.
 *
 * Compatible with AWS S3, Cloudflare R2, MinIO, and any S3-compliant endpoint.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface ObjectStoreConfig {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly forcePathStyle?: boolean;
}

/**
 * Builds an ObjectStoreConfig from process environment variables.
 * Expected variables:
 *   S3_BUCKET              — required
 *   S3_REGION              — required
 *   S3_ENDPOINT            — optional (for non-AWS S3 endpoints)
 *   S3_ACCESS_KEY_ID       — optional (falls back to instance role / env chain)
 *   S3_SECRET_ACCESS_KEY   — optional
 *   S3_FORCE_PATH_STYLE    — "true" for MinIO and other path-style endpoints
 */
export function objectStoreConfigFromEnv(): ObjectStoreConfig {
  const bucket = process.env["S3_BUCKET"];
  const region = process.env["S3_REGION"];
  if (!bucket) throw new Error("S3_BUCKET environment variable is required");
  if (!region) throw new Error("S3_REGION environment variable is required");

  const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
  const endpoint = process.env["S3_ENDPOINT"];

  const base = {
    bucket,
    region,
    forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
  };
  const withCreds =
    accessKeyId && secretAccessKey
      ? { ...base, credentials: { accessKeyId, secretAccessKey } }
      : base;
  return endpoint ? { ...withCreds, endpoint } : withCreds;
}

/**
 * Thin wrapper around the AWS SDK S3 client scoped to a single bucket.
 * All reads and writes are JSON-serialized.
 */
export class EpisodicObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ObjectStoreConfig) {
    const s3Config: S3ClientConfig = { region: config.region };
    if (config.credentials) s3Config.credentials = config.credentials;
    if (config.forcePathStyle !== undefined) s3Config.forcePathStyle = config.forcePathStyle;
    if (config.endpoint) s3Config.endpoint = config.endpoint;
    this.client = new S3Client(s3Config);
    this.bucket = config.bucket;
  }

  /**
   * Writes a JSON-serializable object under the given key.
   * If an object already exists at that key the write is silently skipped,
   * preserving the immutability guarantee of the truth layer.
   */
  async put<T>(key: string, value: T): Promise<void> {
    const exists = await this.exists(key);
    if (exists) return;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        StorageClass: "STANDARD",
      }),
    );
  }

  /**
   * Retrieves and deserializes the object at the given key.
   * Returns undefined when the key does not exist.
   */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await result.Body?.transformToString("utf-8");
      if (!body) return undefined;
      return JSON.parse(body) as T;
    } catch {
      return undefined;
    }
  }

  /** Returns true when an object exists at the given key. */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists all object keys under the given prefix.
   * Uses automatic pagination to return the complete list.
   */
  async list(prefix: string): Promise<ReadonlyArray<string>> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of result.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }
}
