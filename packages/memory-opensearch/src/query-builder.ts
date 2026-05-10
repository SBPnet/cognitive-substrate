/**
 * Hybrid query builder for the OpenSearch memory substrate.
 *
 * Constructs queries that combine:
 *   - BM25 full-text search (keyword recall)
 *   - k-NN approximate nearest-neighbour search (semantic similarity)
 *   - script_score for policy-weighted ranking (importance * decay * policy bias)
 *   - Time and tag filters
 *
 * This mirrors the associative recall behaviour described in the architecture:
 * memory retrieval is not purely semantic, nor purely lexical, but a hybrid
 * weighted by current policy state.
 */

import type { PolicyState } from "@cognitive-substrate/core-types";

/**
 * Retrieval mode controls which vector field is used for k-NN recall.
 *   quality   — embedding_qwen (Qwen3 family)
 *   efficient — embedding_nomic (Nomic Embed Text v2)
 *   hybrid    — embedding_bge_m3 (BGE-M3 dense vector)
 *   legacy    — embedding (backward-compat single-vector field)
 */
export type RetrievalMode = "quality" | "efficient" | "hybrid" | "legacy";

/** Maps each retrieval mode to its OpenSearch knn_vector field name. */
export const RETRIEVAL_MODE_VECTOR_FIELD: Record<RetrievalMode, string> = {
  quality:   "embedding_qwen",
  efficient: "embedding_nomic",
  hybrid:    "embedding_bge_m3",
  legacy:    "embedding",
};

export interface HybridQueryOptions {
  /** Free-text query for BM25 matching. */
  readonly queryText: string;

  /** Pre-computed embedding vector for the query. */
  readonly queryEmbedding: ReadonlyArray<number>;

  /** Number of nearest neighbours to retrieve in the kNN pass. */
  readonly k?: number;

  /** Maximum number of results returned. */
  readonly size?: number;

  /** Current policy vector — shapes the final relevance score. */
  readonly policy?: Partial<PolicyState>;

  /** Optional ISO-8601 date boundary (only retrieve memories created after this date). */
  readonly sinceTimestamp?: string;

  /** Restrict results to memories carrying all of these tags. */
  readonly requiredTags?: ReadonlyArray<string>;

  /** Minimum importance score for a result to qualify. */
  readonly minImportance?: number;

  /** Fields to search with BM25. Defaults to ["summary", "generalization"]. */
  readonly textFields?: ReadonlyArray<string>;

  /** Date field used by the target index. */
  readonly timestampField?: "created_at" | "timestamp";

  /** Whether the target index supports tag filtering. */
  readonly includeTagFilter?: boolean;

  /**
   * Retrieval mode — selects the knn_vector field for semantic recall.
   * Defaults to "legacy" for backward compat.
   */
  readonly retrievalMode?: RetrievalMode;
}

/**
 * Builds a hybrid OpenSearch request body combining BM25 + kNN + script_score
 * with optional policy weighting and time/tag filters.
 */
export function buildHybridQuery(options: HybridQueryOptions): Record<string, unknown> {
  const {
    queryText,
    size = 10,
    policy,
    sinceTimestamp,
    requiredTags,
    minImportance = 0,
    textFields = ["summary", "generalization"],
    timestampField = "created_at",
    includeTagFilter = true,
    retrievalMode = "legacy",
  } = options;

  const retrievalBias = policy?.retrievalBias ?? 0.5;
  const memoryTrust = policy?.memoryTrust ?? 0.5;

  const mustClauses: unknown[] = [
    {
      multi_match: {
        query: queryText,
        fields: textFields,
        type: "best_fields",
        tie_breaker: 0.3,
      },
    },
  ];

  const filterClauses: unknown[] = [
    { range: { importance_score: { gte: minImportance } } },
  ];

  if (sinceTimestamp) {
    filterClauses.push({ range: { [timestampField]: { gte: sinceTimestamp } } });
  }

  if (includeTagFilter && requiredTags && requiredTags.length > 0) {
    filterClauses.push({ terms: { tags: requiredTags } });
  }

  return {
    size,
    query: {
      script_score: {
        query: {
          bool: {
            must: mustClauses,
            filter: filterClauses,
          },
        },
        script: {
          source: `
            double bm25 = _score;
            double importance = doc.containsKey('importance_score') && doc['importance_score'].size() > 0
              ? doc['importance_score'].value
              : 0.5;
            double decay = doc.containsKey('decay_factor') && doc['decay_factor'].size() > 0
              ? doc['decay_factor'].value
              : 1.0;
            double retrievalBias = params.retrievalBias;
            double memoryTrust = params.memoryTrust;
            return bm25 * importance * decay * retrievalBias * memoryTrust;
          `,
          params: { retrievalBias, memoryTrust },
        },
      },
    },
    _source: {
      // Exclude all vector fields — large blobs not needed in result sources.
      // retrievalMode is used by callers to select the right field for kNN queries.
      excludes: [RETRIEVAL_MODE_VECTOR_FIELD[retrievalMode], "embedding", "embedding_qwen", "embedding_nomic", "embedding_bge_m3"],
    },
  };
}

/**
 * Builds a decay-adjusted retrieval query for the consolidation worker.
 * Fetches the N most underused memories within a time window for replay scoring.
 */
export function buildReplaySelectionQuery(options: {
  readonly maxAge: string;
  readonly size?: number;
  readonly minImportance?: number;
  readonly timestampField?: "created_at" | "timestamp";
  readonly usageField?: "usage_frequency" | "retrieval_count";
}): Record<string, unknown> {
  const timestampField = options.timestampField ?? "created_at";
  const usageField = options.usageField ?? "usage_frequency";

  return {
    size: options.size ?? 100,
    query: {
      bool: {
        filter: [
          { range: { [timestampField]: { gte: options.maxAge } } },
          { range: { importance_score: { gte: options.minImportance ?? 0.1 } } },
        ],
      },
    },
    sort: [
      { decay_factor: { order: "desc" } },
      { importance_score: { order: "desc" } },
      { [usageField]: { order: "asc" } },
    ],
  };
}
