/**
 * Consolidation-engine type surface.
 *
 * Consolidation is the offline "sleep cycle" of the substrate: high-value
 * recent experiences are replayed, summarised into a single semantic memory,
 * indexed in `memory_semantic`, and then their decay rate is adjusted so
 * that they survive longer in the working set.
 */

import type { SemanticMemory } from "@cognitive-substrate/core-types";

/** Trigger payload for one consolidation cycle. */
export interface ConsolidationRequest {
  readonly requestId: string;
  readonly timestamp: string;
  /** ISO-8601 lower bound on `timestamp` for replay candidate selection. */
  readonly maxAge: string;
  /** Maximum number of replay candidates to consider. */
  readonly size?: number;
  /** Importance floor; events below this score are excluded. */
  readonly minImportance?: number;
  /** When provided, only candidates carrying ALL of these tags are selected. */
  readonly requiredTags?: ReadonlyArray<string>;
}

/**
 * One replayable experience event materialised into the engine's working
 * shape. Embeddings and tags are preserved so that the consolidation
 * model can compute aggregate signals without re-querying OpenSearch.
 */
export interface ReplayCandidate {
  readonly memoryId: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly embedding: ReadonlyArray<number>;
  readonly importanceScore: number;
  readonly rewardScore: number;
  readonly retrievalCount: number;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Output of the consolidation model. Holds the synthesised text and
 * embedding for the new semantic memory but no provenance fields; the
 * engine attaches `sourceEventIds` and identity metadata afterwards.
 */
export interface ConsolidationDraft {
  readonly summary: string;
  readonly generalization: string;
  readonly embedding: ReadonlyArray<number>;
  /** Tag adopted as the dominant semantic cluster, if any. */
  readonly semanticCluster?: string;
}

/**
 * Pluggable consolidation strategy. The default `ExtractiveConsolidationModel`
 * is a deterministic, embedding-aware extractive summariser; a future
 * abstractive model (LLM-backed or otherwise) can be substituted by
 * implementing this interface.
 */
export interface ConsolidationModel {
  generate(candidates: ReadonlyArray<ReplayCandidate>): Promise<ConsolidationDraft>;
}

/** Successful outcome of one consolidation cycle. */
export interface ConsolidationResult {
  readonly requestId: string;
  readonly timestamp: string;
  readonly semanticMemory: SemanticMemory;
  readonly sourceEventIds: ReadonlyArray<string>;
}

/**
 * Loose shape used when reading from the `experience_events` index. Field
 * names mirror the snake_case index mapping so that hits can be projected
 * into `ReplayCandidate` without an explicit cast.
 */
export interface ExperienceReplayDocument extends Record<string, unknown> {
  readonly event_id?: string;
  readonly timestamp?: string;
  readonly summary?: string;
  readonly embedding?: ReadonlyArray<number>;
  readonly importance_score?: number;
  readonly reward_score?: number;
  readonly retrieval_count?: number;
  readonly tags?: ReadonlyArray<string>;
}
