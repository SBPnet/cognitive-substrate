import type {
  MemoryIndex,
  MemoryReference,
  PolicyState,
  RetrievalFeedback,
} from "@cognitive-substrate/core-types";

export type RetrievalSearchIndex = Extract<
  MemoryIndex,
  "experience_events" | "memory_semantic"
>;

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

export interface RetrievalRequest {
  readonly queryText: string;
  readonly queryEmbedding?: ReadonlyArray<number>;
  readonly size?: number;
  readonly perIndexSize?: number;
  readonly policy?: Partial<PolicyState>;
  readonly sinceTimestamp?: string;
  readonly requiredTags?: ReadonlyArray<string>;
  readonly minImportance?: number;
  readonly indexes?: ReadonlyArray<RetrievalSearchIndex>;
}

export interface RetrievalResult {
  readonly memories: ReadonlyArray<MemoryReference>;
  readonly queryEmbedding: ReadonlyArray<number>;
}

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

export type RetrievalFeedbackRecord = RetrievalFeedback;

export interface ExperienceEventSearchDocument extends Record<string, unknown> {
  readonly event_id?: string;
  readonly timestamp?: string;
  readonly summary?: string;
  readonly importance_score?: number;
  readonly tags?: ReadonlyArray<string>;
}

export interface SemanticMemorySearchDocument extends Record<string, unknown> {
  readonly memory_id?: string;
  readonly created_at?: string;
  readonly summary?: string;
  readonly generalization?: string;
  readonly importance_score?: number;
  readonly last_retrieved?: string;
}

export type RetrievalSearchDocument =
  | ExperienceEventSearchDocument
  | SemanticMemorySearchDocument;
