/**
 * Embedding client abstraction.
 *
 * The production implementation calls an OpenAI-compatible embeddings endpoint.
 * The interface is kept thin so that alternative embedding providers (local
 * models, Cohere, Vertex AI) can be substituted without changing the worker logic.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EmbeddingClient {
  embed(text: string): Promise<ReadonlyArray<number>>;
  readonly dimension: number;
}

export interface OpenAIEmbeddingConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dimension: number;
  readonly endpoint: string;
}

export interface VertexEmbeddingConfig {
  readonly projectId: string;
  readonly location: string;
  readonly model: string;
  readonly dimension: number;
}

/**
 * Builds an OpenAIEmbeddingConfig from process environment variables.
 */
export function openAIEmbeddingConfigFromEnv(): OpenAIEmbeddingConfig {
  const apiKey = process.env["OPENAI_API_KEY"] ?? "";
  const model = process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small";
  const dimension = parseInt(process.env["EMBEDDING_DIMENSION"] ?? "1536", 10);
  const endpoint =
    process.env["EMBEDDING_ENDPOINT"] ?? "https://api.openai.com/v1/embeddings";

  return { apiKey, model, dimension, endpoint };
}

export function vertexEmbeddingConfigFromEnv(): VertexEmbeddingConfig {
  const projectId =
    process.env["GCP_PROJECT_ID"] ??
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    "";
  const location = process.env["GCP_LOCATION"] ?? "us-central1";
  const model = process.env["VERTEX_EMBED_MODEL"] ?? "gemini-embedding-001";
  const dimension = parseInt(process.env["EMBEDDING_DIMENSION"] ?? "1536", 10);

  return { projectId, location, model, dimension };
}

/** Calls an OpenAI-compatible embeddings endpoint. */
export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly dimension: number;
  private readonly config: OpenAIEmbeddingConfig;

  constructor(config: OpenAIEmbeddingConfig) {
    this.config = config;
    this.dimension = config.dimension;
  }

  async embed(text: string): Promise<ReadonlyArray<number>> {
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.model, input: text }),
    });

    if (!response.ok) {
      throw new Error(
        `Embedding request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const embedding = data.data[0]?.embedding;
    if (!embedding) throw new Error("Embedding response contained no data");
    return embedding;
  }
}

/** Calls Vertex AI Gemini embeddings using local Application Default Credentials. */
export class VertexEmbeddingClient implements EmbeddingClient {
  readonly dimension: number;
  private readonly config: VertexEmbeddingConfig;

  constructor(config: VertexEmbeddingConfig) {
    if (config.projectId.trim().length === 0) {
      throw new Error("Vertex embeddings require GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT");
    }
    this.config = config;
    this.dimension = config.dimension;
  }

  async embed(text: string): Promise<ReadonlyArray<number>> {
    const accessToken = await this.getAccessToken();
    const endpoint =
      `https://${this.config.location}-aiplatform.googleapis.com/v1/` +
      `projects/${this.config.projectId}/locations/${this.config.location}/` +
      `publishers/google/models/${this.config.model}:predict`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instances: [
          {
            content: text,
            task_type: "RETRIEVAL_DOCUMENT",
          },
        ],
        parameters: {
          outputDimensionality: this.config.dimension,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Vertex embedding request failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }

    const data = (await response.json()) as {
      predictions?: Array<{
        embeddings?: {
          values?: number[];
        };
      }>;
    };
    const embedding = data.predictions?.[0]?.embeddings?.values;
    if (!embedding) throw new Error("Vertex embedding response contained no data");
    return embedding;
  }

  private async getAccessToken(): Promise<string> {
    const { stdout } = await execFileAsync("gcloud", [
      "auth",
      "application-default",
      "print-access-token",
    ]);
    const token = stdout.trim();
    if (!token) throw new Error("gcloud returned an empty ADC access token");
    return token;
  }
}

/**
 * A deterministic stub embedder for use in tests and local development.
 * Produces a zero-vector of the given dimension.
 */
export class StubEmbeddingClient implements EmbeddingClient {
  readonly dimension: number;

  constructor(dimension = 1536) {
    this.dimension = dimension;
  }

  async embed(_text: string): Promise<ReadonlyArray<number>> {
    return new Array(this.dimension).fill(0) as number[];
  }
}
