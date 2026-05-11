import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { QueryEmbeddingClient } from "@cognitive-substrate/retrieval-engine";

const execFileAsync = promisify(execFile);

export class ZeroEmbeddingClient implements QueryEmbeddingClient {
  private readonly dimension: number;

  constructor(dimension: number = 1536) {
    this.dimension = dimension;
  }

  async embed(): Promise<ReadonlyArray<number>> {
    return Array.from({ length: this.dimension }, () => 0);
  }
}

export function embeddingDimensionFromEnv(): number {
  return Number.parseInt(process.env["EMBEDDING_DIMENSION"] ?? "1536", 10);
}

export class OpenAIQueryEmbeddingClient implements QueryEmbeddingClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(config: {
    readonly apiKey: string;
    readonly model: string;
    readonly endpoint: string;
  }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.endpoint = config.endpoint;
  }

  async embed(text: string): Promise<ReadonlyArray<number>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      throw new Error(
        `Query embedding request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error("Query embedding response contained no data");
    return embedding;
  }
}

export class VertexQueryEmbeddingClient implements QueryEmbeddingClient {
  private readonly projectId: string;
  private readonly location: string;
  private readonly model: string;
  private readonly dimension: number;

  constructor(config: {
    readonly projectId: string;
    readonly location: string;
    readonly model: string;
    readonly dimension: number;
  }) {
    if (config.projectId.trim().length === 0) {
      throw new Error("Vertex embeddings require GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT");
    }
    this.projectId = config.projectId;
    this.location = config.location;
    this.model = config.model;
    this.dimension = config.dimension;
  }

  async embed(text: string): Promise<ReadonlyArray<number>> {
    const accessToken = await this.getAccessToken();
    const endpoint =
      `https://${this.location}-aiplatform.googleapis.com/v1/` +
      `projects/${this.projectId}/locations/${this.location}/` +
      `publishers/google/models/${this.model}:predict`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instances: [{ content: text, task_type: "RETRIEVAL_QUERY" }],
        parameters: { outputDimensionality: this.dimension },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Vertex query embedding request failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }

    const data = (await response.json()) as {
      predictions?: Array<{ embeddings?: { values?: number[] } }>;
    };
    const embedding = data.predictions?.[0]?.embeddings?.values;
    if (!embedding) throw new Error("Vertex query embedding response contained no data");
    return embedding;
  }

  private async getAccessToken(): Promise<string> {
    const credsJson = process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
    if (credsJson) {
      const creds = JSON.parse(credsJson) as {
        type?: string;
        client_id?: string;
        client_secret?: string;
        refresh_token?: string;
      };
      if (
        creds.type === "authorized_user" &&
        creds.client_id &&
        creds.client_secret &&
        creds.refresh_token
      ) {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            refresh_token: creds.refresh_token,
            grant_type: "refresh_token",
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`OAuth2 token refresh failed: ${res.status} ${body}`.trim());
        }
        const data = (await res.json()) as { access_token?: string };
        if (!data.access_token) throw new Error("No access_token in OAuth2 response");
        return data.access_token;
      }
    }
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

export function queryEmbedderFromEnv(): QueryEmbeddingClient {
  const provider = process.env["EMBEDDING_PROVIDER"] ?? "stub";
  const dimension = embeddingDimensionFromEnv();

  if (provider === "stub" || provider === "zero") {
    return new ZeroEmbeddingClient(dimension);
  }

  if (provider === "openai" || provider === "openai_compat") {
    return new OpenAIQueryEmbeddingClient({
      apiKey: process.env["OPENAI_API_KEY"] ?? "",
      model: process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small",
      endpoint: process.env["EMBEDDING_ENDPOINT"] ?? "https://api.openai.com/v1/embeddings",
    });
  }

  if (provider === "vertex") {
    return new VertexQueryEmbeddingClient({
      projectId: process.env["GCP_PROJECT_ID"] ?? process.env["GOOGLE_CLOUD_PROJECT"] ?? "",
      location: process.env["GCP_LOCATION"] ?? "us-central1",
      model: process.env["VERTEX_EMBED_MODEL"] ?? "gemini-embedding-001",
      dimension,
    });
  }

  throw new Error(`Unsupported EMBEDDING_PROVIDER for orchestrator: ${provider}`);
}
