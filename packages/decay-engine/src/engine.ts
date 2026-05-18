/**
 * Decay / forgetting engine.
 *
 * `DecayEngine.planForgetting` evaluates each candidate against a
 * cascading set of thresholds:
 *
 *   1. High contradiction with low retention          -> retire.
 *   2. Retention ≤ retirementThreshold (0.22)         -> prune.
 *   3. Retention ≤ suppressionThreshold (0.28)        -> suppress.
 *   4. Retention ≤ compressionThreshold (0.45)
 *      AND ageDays > compressAgeDays (30)             -> compress.
 *   5. Otherwise                                      -> retain.
 *
 * The compress gate is retention-band based, not importance-score based.
 * This means any signal whose retention has decayed into the mid-band
 * (0.28–0.45) after 30+ days gets consolidated, regardless of its original
 * importance. Concretely at default parameters:
 *   - normal signals: suppress ~0–14d, prune from ~14d onward
 *   - recovery signals: retain ~0–30d, compress from ~45d
 *   - degraded signals: retain ~0–44d, compress from ~45d
 *   - outage signals: retain ~0–89d, compress from ~90d
 *
 * In parallel it prunes the association graph by removing memory links
 * whose strength falls below `pruneStrengthThreshold`. The thresholds are
 * exposed through `DecayEngineOptions` so that operators can tighten or
 * loosen forgetting without recompiling the engine.
 */

import type { MemoryLink } from "@cognitive-substrate/core-types";
import type {
  CompressionCluster,
  ForgettingCandidate,
  ForgettingDecision,
  ForgettingPlan,
  GraphPruningResult,
} from "./types.js";

export interface DecayEngineOptions {
  /** Retention below this triggers `suppress`. Default 0.28. */
  readonly suppressionThreshold?: number;
  /** Retention below this triggers `prune`. Default 0.22. */
  readonly retirementThreshold?: number;
  /**
   * Retention at or below this triggers `compress` when the candidate is also
   * older than `compressAgeDays`. Must be > suppressionThreshold. Default 0.45.
   */
  readonly compressionThreshold?: number;
  /** Age in days above which a mid-retention candidate is compressed. Default 30. */
  readonly compressAgeDays?: number;
  /** Memory-graph edges below this strength are dropped during pruning. */
  readonly pruneStrengthThreshold?: number;
}

export class DecayEngine {
  private readonly suppressionThreshold: number;
  private readonly retirementThreshold: number;
  private readonly compressionThreshold: number;
  private readonly compressAgeDays: number;
  private readonly pruneStrengthThreshold: number;

  constructor(options: DecayEngineOptions = {}) {
    this.suppressionThreshold = options.suppressionThreshold ?? 0.28;
    this.retirementThreshold = options.retirementThreshold ?? 0.22;
    this.compressionThreshold = options.compressionThreshold ?? 0.45;
    this.compressAgeDays = options.compressAgeDays ?? 30;
    this.pruneStrengthThreshold = options.pruneStrengthThreshold ?? 0.15;
  }

  /**
   * Builds a complete forgetting plan covering candidate decisions,
   * compression clustering, and association-graph pruning.
   */
  planForgetting(
    candidates: ReadonlyArray<ForgettingCandidate>,
    links: ReadonlyArray<MemoryLink> = [],
  ): ForgettingPlan {
    const decisions = candidates.map((candidate) => this.decide(candidate));
    return {
      decisions,
      compressionClusters: buildCompressionClusters(candidates, decisions),
      graphPruning: this.pruneGraph(links),
    };
  }

  /**
   * Classifies a single candidate. The cascade short-circuits at the
   * first matching threshold so that, for example, a high-contradiction
   * memory is retired even if its raw retention score would have only
   * triggered suppression.
   */
  decide(candidate: ForgettingCandidate): ForgettingDecision {
    const retentionScore = scoreRetention(candidate);
    const contradiction = candidate.contradictionScore ?? 0;
    const suppressionWeight = clamp(1 - retentionScore + contradiction * 0.3);

    if (contradiction >= 0.8 && retentionScore < 0.45) {
      return decision(candidate, "retire", suppressionWeight, retentionScore, "high_contradiction");
    }
    if (retentionScore <= this.retirementThreshold) {
      return decision(candidate, "prune", suppressionWeight, retentionScore, "low_retention");
    }
    if (retentionScore <= this.suppressionThreshold) {
      return decision(candidate, "suppress", suppressionWeight, retentionScore, "retrieval_suppression");
    }
    if (retentionScore <= this.compressionThreshold && (candidate.ageDays ?? 0) > this.compressAgeDays) {
      return decision(candidate, "compress", suppressionWeight, retentionScore, "compression_candidate");
    }
    return decision(candidate, "retain", suppressionWeight, retentionScore, "retained");
  }

  /** Drops association-graph edges whose strength is below the threshold. */
  pruneGraph(links: ReadonlyArray<MemoryLink>): GraphPruningResult {
    const retainedLinks = links.filter((link) => link.strength >= this.pruneStrengthThreshold);
    const prunedLinks = links.filter((link) => link.strength < this.pruneStrengthThreshold);
    return { retainedLinks, prunedLinks };
  }
}

/**
 * Composite retention score in `[0, 1]`.
 *
 *   - importance: 35% of the score (dominant term).
 *   - retrieval relevance score: 20%.
 *   - usage / retrieval count: 20% (capped at 20 retrievals).
 *   - recency: 15% (decays linearly over 90 days).
 *   - strategic value: 10%.
 *   - contradiction penalty: subtracts up to 35% directly.
 */
export function scoreRetention(candidate: ForgettingCandidate): number {
  const recency = clamp(1 - (candidate.ageDays ?? 0) / 90);
  const use = clamp(candidate.retrievalCount / 20);
  const contradictionPenalty = (candidate.contradictionScore ?? 0) * 0.35;
  return clamp(
    candidate.memory.importanceScore * 0.35
      + candidate.memory.score * 0.2
      + use * 0.2
      + recency * 0.15
      + (candidate.strategicValue ?? 0.5) * 0.1
      - contradictionPenalty,
  );
}

/**
 * Builds the compression-cluster list. Currently emits at most one
 * cluster containing every candidate flagged for compression. Future
 * revisions may split by semantic similarity once embeddings are
 * available at this stage.
 */
function buildCompressionClusters(
  candidates: ReadonlyArray<ForgettingCandidate>,
  decisions: ReadonlyArray<ForgettingDecision>,
): ReadonlyArray<CompressionCluster> {
  const memoryIds = decisions
    .filter((item) => item.action === "compress")
    .map((item) => item.memoryId);
  if (memoryIds.length === 0) return [];

  return [{
    clusterId: "compression-candidate-cluster",
    memoryIds,
    compressionPriority: clamp(memoryIds.length / Math.max(1, candidates.length)),
    summaryHint: "Compress low-recency memories that remain semantically useful.",
  }];
}

function decision(
  candidate: ForgettingCandidate,
  action: ForgettingDecision["action"],
  suppressionWeight: number,
  retentionScore: number,
  reason: string,
): ForgettingDecision {
  return {
    memoryId: candidate.memory.memoryId,
    action,
    suppressionWeight,
    retentionScore,
    reason,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
