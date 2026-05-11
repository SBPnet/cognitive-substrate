/**
 * Decay-engine type surface.
 *
 * The decay engine is the forgetting layer of the substrate. It scores
 * each memory candidate for retention and emits a `ForgettingPlan` that
 * tells downstream workers which memories to retain, suppress, compress,
 * retire, or prune outright. It also prunes the association graph by
 * dropping low-strength edges.
 */

import type { MemoryLink, MemoryReference } from "@cognitive-substrate/core-types";

/**
 * The five outcomes a single memory can receive in a forgetting plan.
 *
 *   - `retain`   : keep at full priority.
 *   - `suppress` : penalise during retrieval but keep on disk.
 *   - `compress` : merge into a semantic memory during the next cycle.
 *   - `retire`   : flag as obsolete; do not surface in retrieval.
 *   - `prune`    : delete or archive permanently.
 */
export type ForgettingAction = "retain" | "suppress" | "compress" | "retire" | "prune";

/**
 * One memory under consideration. The optional fields refine the
 * retention score; missing fields fall back to neutral defaults.
 */
export interface ForgettingCandidate {
  readonly memory: MemoryReference;
  readonly retrievalCount: number;
  readonly contradictionScore?: number;
  readonly ageDays?: number;
  /** Caller-supplied importance for goal alignment, in `[0, 1]`. Defaults to 0.5. */
  readonly strategicValue?: number;
}

/** Per-memory outcome of one decay pass. */
export interface ForgettingDecision {
  readonly memoryId: string;
  readonly action: ForgettingAction;
  /** Penalty to apply during retrieval ranking, in `[0, 1]`. */
  readonly suppressionWeight: number;
  /** Computed retention score that drove the action choice, in `[0, 1]`. */
  readonly retentionScore: number;
  /** Machine-readable tag explaining the action. */
  readonly reason: string;
}

/** A group of `compress`-flagged memories destined for the next consolidation. */
export interface CompressionCluster {
  readonly clusterId: string;
  readonly memoryIds: ReadonlyArray<string>;
  readonly compressionPriority: number;
  /** Hint passed to the consolidation model when the cluster is processed. */
  readonly summaryHint: string;
}

/** Output of the association-graph pruning step. */
export interface GraphPruningResult {
  readonly retainedLinks: ReadonlyArray<MemoryLink>;
  readonly prunedLinks: ReadonlyArray<MemoryLink>;
}

/** Aggregate output of one decay cycle. */
export interface ForgettingPlan {
  readonly decisions: ReadonlyArray<ForgettingDecision>;
  readonly compressionClusters: ReadonlyArray<CompressionCluster>;
  readonly graphPruning?: GraphPruningResult;
}
