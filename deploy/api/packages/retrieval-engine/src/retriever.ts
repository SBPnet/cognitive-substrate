import type { Client } from "@opensearch-project/opensearch";
import {
  buildHybridQuery,
  search,
  type CognitiveIndex,
} from "@cognitive-substrate/memory-opensearch";
import { mapSearchHitToMemoryReference, type SearchHit } from "./mapper.js";
import type {
  QueryEmbeddingClient,
  RerankClient,
  RetrievalRequest,
  RetrievalResult,
  RetrievalSearchDocument,
  RetrievalSearchIndex,
} from "./types.js";

type RetrievalSearchClient = (
  client: Client,
  index: CognitiveIndex,
  query: Record<string, unknown>,
) => Promise<Array<SearchHit<RetrievalSearchDocument>>>;

export interface MemoryRetrieverConfig {
  readonly openSearch: Client;
  readonly embedder?: QueryEmbeddingClient;
  readonly searchClient?: RetrievalSearchClient;
  /**
   * Optional Tier 2 reranker (cross-encoder).  When provided, the initial
   * k-NN recall set is re-scored before the final slice is returned.
   * Use the OpenSearchMlClient.rerank() method bound to a deployed
   * bge-reranker or ms-marco cross-encoder model.
   */
  readonly reranker?: RerankClient;
  /**
   * Multiplier applied to perIndexSize when fetching initial k-NN candidates
   * for reranking.  A value of 3 fetches 3× the requested results so the
   * reranker has enough candidates to choose from.  Defaults to 3.
   */
  readonly rerankOverfetchFactor?: number;
}

const DEFAULT_INDEXES: ReadonlyArray<RetrievalSearchIndex> = [
  "memory_semantic",
  "experience_events",
];

export class MemoryRetriever {
  private readonly openSearch: Client;
  private readonly embedder: QueryEmbeddingClient | undefined;
  private readonly searchClient: RetrievalSearchClient;
  private readonly reranker: RerankClient | undefined;
  private readonly rerankOverfetchFactor: number;

  constructor(config: MemoryRetrieverConfig) {
    this.openSearch = config.openSearch;
    this.embedder = config.embedder;
    this.searchClient = config.searchClient ?? search<RetrievalSearchDocument>;
    this.reranker = config.reranker;
    this.rerankOverfetchFactor = config.rerankOverfetchFactor ?? 3;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const queryEmbedding = await this.resolveEmbedding(request);
    const indexes = request.indexes ?? DEFAULT_INDEXES;
    const finalSize = request.size ?? 10;

    // When a reranker is configured, over-fetch candidates so the cross-encoder
    // has a large enough pool to meaningfully improve precision.
    const perIndexSize = this.reranker
      ? (request.perIndexSize ?? finalSize) * this.rerankOverfetchFactor
      : (request.perIndexSize ?? finalSize);

    const hitsByIndex = await Promise.all(
      indexes.map(async (index) => {
        const query = buildHybridQuery({
          queryText: request.queryText,
          queryEmbedding,
          size: perIndexSize,
          k: perIndexSize,
          ...queryOptionsForIndex(index),
          ...definedHybridOptions(request),
        });

        const hits = await this.searchClient(
          this.openSearch,
          index as CognitiveIndex,
          query,
        );

        return { index, hits };
      }),
    );

    const candidates = hitsByIndex.flatMap(({ index, hits }) =>
      hits.map((hit) =>
        mapSearchHitToMemoryReference(
          index,
          hit as SearchHit<RetrievalSearchDocument>,
        ),
      ),
    );

    if (this.reranker && candidates.length > 0) {
      return {
        memories: await this.applyReranking(request.queryText, candidates, finalSize),
        queryEmbedding,
      };
    }

    const memories = candidates
      .sort((left, right) => right.score - left.score)
      .slice(0, finalSize);

    return { memories, queryEmbedding };
  }

  private async applyReranking(
    query: string,
    candidates: RetrievalResult["memories"],
    finalSize: number,
  ): Promise<RetrievalResult["memories"]> {
    const texts = candidates.map((m) => m.summary ?? "");
    const rerankScores = await this.reranker!.rerank(query, texts);

    const scored = candidates.map((memory, index) => ({
      ...memory,
      score: rerankScores.find((r) => r.documentIndex === index)?.score ?? memory.score,
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, finalSize);
  }

  private async resolveEmbedding(
    request: RetrievalRequest,
  ): Promise<ReadonlyArray<number>> {
    if (request.queryEmbedding) return request.queryEmbedding;
    if (!this.embedder) {
      throw new Error("queryEmbedding is required when no retrieval embedder is configured");
    }
    return this.embedder.embed(request.queryText);
  }
}

function definedHybridOptions(request: RetrievalRequest): Partial<{
  readonly policy: NonNullable<RetrievalRequest["policy"]>;
  readonly sinceTimestamp: string;
  readonly requiredTags: ReadonlyArray<string>;
  readonly minImportance: number;
}> {
  return {
    ...(request.policy ? { policy: request.policy } : {}),
    ...(request.sinceTimestamp ? { sinceTimestamp: request.sinceTimestamp } : {}),
    ...(request.requiredTags ? { requiredTags: request.requiredTags } : {}),
    ...(request.minImportance !== undefined
      ? { minImportance: request.minImportance }
      : {}),
  };
}

function queryOptionsForIndex(index: RetrievalSearchIndex): {
  readonly textFields: ReadonlyArray<string>;
  readonly timestampField: "created_at" | "timestamp";
  readonly includeTagFilter: boolean;
} {
  if (index === "experience_events") {
    return {
      textFields: ["summary"],
      timestampField: "timestamp",
      includeTagFilter: true,
    };
  }

  return {
    textFields: ["summary", "generalization"],
    timestampField: "created_at",
    includeTagFilter: false,
  };
}
