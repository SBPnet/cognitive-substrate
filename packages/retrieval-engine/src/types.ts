/**
 * Retrieval-engine type surface.
 *
 * The retrieval engine is the read path of the memory substrate. It
 * combines BM25, k-NN, and optional cross-encoder reranking over the
 * `experience_events` and `memory_semantic` indexes, and emits feedback
 * back into the `retrieval_feedback` index so that the system can learn
 * from its own retrieval choices over time.
 *
 * Embedding providers are abstracted behind `QueryEmbeddingClient`; the
 * default implementations target an OpenAI-compatible `/v1/embeddings`
 * endpoint, which lets the same code run against OpenAI itself, a local
 * inference server, or any compatible model lane.
 */

import type {
  MemoryIndex,
  MemoryReference,
  PolicyState,
  RetrievalFeedback,
} from "@cognitive-substrate/core-types";
import type {
  RetrievalFusionOptions,
  RetrievalMode,
} from "@cognitive-substrate/memory-opensearch";

/** Indexes that the retrieval engine reads from. */
export type RetrievalSearchIndex = Extract<
  MemoryIndex,
  "experience_events" | "memory_semantic"
>;

/**
 * Pluggable embedder used to convert query text into a vector. The
 * production implementation typically targets an OpenAI-compatible
 * `/v1/embeddings` endpoint; tests can substitute a stub returning
 * deterministic zero vectors.
 */
export interface QueryEmbeddingClient {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

/**
 * Tier 2 reranker interface — a cross-encoder that scores (query, candidate)
 * pairs to improve precision after the initial k-NN vector recall step.
 * The OpenSearchMlClient.rerank() method satisfies this interface.
 */
export interface RerankClient {
  rerank(
    query: string,
    candidates: string[],
  ): Promise<Array<{ documentIndex: number; score: number }>>;
}

/** Inputs to one retrieval call. */
export interface RetrievalRequest {
  readonly queryText: string;
  /** Pre-computed embedding. When omitted, the configured embedder is invoked. */
  readonly queryEmbedding?: ReadonlyArray<number>;
  /** Final number of memories returned after fusion and optional rerank. */
  readonly size?: number;
  /** Number of candidates pulled from each index before fusion. */
  readonly perIndexSize?: number;
  /** Optional policy state used to weight BM25 vs k-NN fusion. */
  readonly policy?: Partial<PolicyState>;
  readonly sinceTimestamp?: string;
  readonly requiredTags?: ReadonlyArray<string>;
  readonly minImportance?: number;
  /** Indexes to search; defaults to memory_semantic + experience_events. */
  readonly indexes?: ReadonlyArray<RetrievalSearchIndex>;
  /**
   * Which vector field to use for k-NN recall.
   * Defaults to "legacy" (the original "embedding" field) for backward compat.
   */
  readonly retrievalMode?: RetrievalMode;
  readonly fusion?: RetrievalFusionOptions;
}

export { RetrievalFusionOptions, RetrievalMode };

/** Output of one retrieval call. */
export interface RetrievalResult {
  readonly memories: ReadonlyArray<MemoryReference>;
  /** Embedding actually used for the k-NN pass; useful for tracing. */
  readonly queryEmbedding: ReadonlyArray<number>;
}

/**
 * Caller-friendly subset of `RetrievalFeedback` used to record one
 * feedback observation. Server-managed fields (`feedbackId`, `timestamp`)
 * are filled in by the writer when omitted.
 */
export interface RetrievalFeedbackInput {
  readonly feedbackId?: string;
  readonly timestamp?: string;
  readonly querySummary: string;
  readonly retrievedMemoryId: string;
  readonly usedInResponse: boolean;
  readonly helpfulnessScore: number;
  readonly hallucinationDetected: boolean;
  readonly futureWeightAdjustment: number;
}

/** Persisted shape; identical to the core-types `RetrievalFeedback`. */
export type RetrievalFeedbackRecord = RetrievalFeedback;

/**
 * Loose source-document shape from the `experience_events` index. Field
 * names mirror the snake_case index mapping so that hits can be projected
 * without translation.
 */
export interface ExperienceEventSearchDocument extends Record<string, unknown> {
  readonly event_id?: string;
  readonly timestamp?: string;
  readonly summary?: string;
  readonly importance_score?: number;
  readonly tags?: ReadonlyArray<string>;
}

/** Loose source-document shape from the `memory_semantic` index. */
export interface SemanticMemorySearchDocument extends Record<string, unknown> {
  readonly memory_id?: string;
  readonly created_at?: string;
  readonly summary?: string;
  readonly generalization?: string;
  readonly importance_score?: number;
  readonly last_retrieved?: string;
}

/** Discriminated union of search-document shapes used by the mapper. */
export type RetrievalSearchDocument =
  | ExperienceEventSearchDocument
  | SemanticMemorySearchDocument;
