/**
 * Policy-engine type surface.
 *
 * The policy engine is the closed-loop component that converts reinforcement
 * outcomes into bounded updates of the runtime PolicyState vector. The shape
 * of PolicyState itself lives in `@cognitive-substrate/core-types`; this
 * module defines the inputs, outputs, and persistence contract used by the
 * engine to mutate that state safely.
 */

import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";

/**
 * Keys of the mutable policy vector. Excludes metadata fields (`version`,
 * `timestamp`) so that delta computations cannot accidentally write to them.
 */
export type PolicyVectorKey = Exclude<keyof PolicyState, "version" | "timestamp">;

/**
 * Sparse delta applied to a PolicyState. Each entry represents an additive
 * change to the corresponding policy dimension. Values are clamped before
 * being applied so that no single evaluation can drive the state outside
 * `[0, 1]` or beyond the per-step drift bound.
 */
export type PolicyDelta = Partial<Record<PolicyVectorKey, number>>;

/**
 * One reinforcement observation feeding the policy engine.
 *
 * `rewardDelta` is the dominant signal; the optional fields refine the
 * direction of the update by attributing credit or blame to memory use,
 * tool use, goal progress, or contradiction risk. Engines that lack these
 * signals can omit them and the drift calculation falls back to neutral
 * defaults.
 */
export interface PolicyEvaluationInput {
  /** ID of the experience event that produced this evaluation. */
  readonly sourceExperienceId: string;
  /** Optional consolidation cluster that aggregated the evaluation. */
  readonly sourceClusterId?: string;
  /** Signed reward signal, expected in `[-1, 1]`. */
  readonly rewardDelta: number;
  /** Confidence the agent had in its proposal at decision time. */
  readonly confidence?: number;
  /** Estimated risk of contradicting an existing high-confidence memory. */
  readonly contradictionRisk?: number;
  /** Whether retrieved memory contributed to the outcome. */
  readonly memoryUsefulness?: number;
  /** Whether tool invocation contributed to the outcome. */
  readonly toolUsefulness?: number;
  /** Goal-progress fraction observed during the interaction. */
  readonly goalProgress?: number;
}

/** Result of a single policy update cycle. */
export interface PolicyUpdateResult {
  readonly previous: PolicyState;
  readonly next: PolicyState;
  readonly event: PolicyUpdateEvent;
}

/**
 * Flat persistence record matching the `policy_state` OpenSearch index
 * mapping. Field names use snake_case so that they round-trip through
 * indexers without translation. Extends `Record<string, unknown>` so that
 * indexer helpers can accept it without explicit casts.
 */
export interface PolicySnapshotRecord extends Record<string, unknown> {
  readonly policy_id: string;
  readonly timestamp: string;
  readonly retrieval_bias: number;
  readonly tool_bias: number;
  readonly risk_tolerance: number;
  readonly memory_trust: number;
  readonly exploration_factor: number;
  readonly goal_persistence: number;
  readonly working_memory_decay_rate: number;
  readonly source_experience_id?: string;
  readonly source_cluster_id?: string;
  readonly reward_delta?: number;
}

/**
 * Persistence contract for policy snapshots.
 *
 * Implementations decide whether the current state lives in memory, in
 * OpenSearch, or in both. The engine treats `getCurrent` as a cache-friendly
 * read and `saveSnapshot` as the write boundary; durability and replication
 * concerns belong to the implementing class.
 */
export interface PolicyStore {
  getCurrent(): Promise<PolicyState | undefined>;
  saveSnapshot(
    state: PolicyState,
    event?: PolicyUpdateEvent,
  ): Promise<void>;
}
