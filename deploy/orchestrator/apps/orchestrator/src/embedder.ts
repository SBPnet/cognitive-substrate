import type { QueryEmbeddingClient } from "@cognitive-substrate/retrieval-engine";

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
