/**
 * Narrative-engine type surface.
 *
 * The narrative engine is the slowest-moving layer of the substrate. It
 * accumulates identity evidence over many cycles, applies drift
 * stabilisation so the identity vector cannot move quickly even under
 * sustained pressure, and synthesises a `NarrativeSelfModel` plus an
 * `IdentityUpdateEvent` that downstream subscribers can use to refresh
 * narrative-aware policies.
 *
 * The "selfhood" terminology here is computational analogy: the engine
 * groups episodes into themed threads and projects future-self states
 * to support coherent long-horizon planning. It does not claim
 * subjective experience.
 */

import type { IdentityState, IdentityUpdateEvent } from "@cognitive-substrate/core-types";

/** Keys of the mutable identity vector. */
export type IdentityVectorKey = Exclude<keyof IdentityState, "identityId" | "timestamp">;

/** Sparse delta applied to identity dimensions. */
export type IdentityDelta = Partial<Record<IdentityVectorKey, number>>;

/**
 * One piece of evidence influencing the identity vector. Most fields are
 * optional so callers can supply only the deltas that are relevant to
 * their layer (e.g. the reinforcement engine sets `curiosityDelta`,
 * `cautionDelta`, and `stabilityDelta`).
 */
export interface IdentityEvidence {
  readonly sourceMemoryId: string;
  readonly timestamp?: string;
  readonly curiosityDelta?: number;
  readonly cautionDelta?: number;
  readonly verbosityDelta?: number;
  readonly toolDependenceDelta?: number;
  readonly explorationPreferenceDelta?: number;
  readonly stabilityDelta?: number;
  /** Reinforcement signal in `[0, 1]` used to shape the curiosity dimension. */
  readonly reinforcement?: number;
  /** Contradiction risk in `[0, 1]` used to shape the caution dimension. */
  readonly contradictionRisk?: number;
  /** Optional free-text fragment surfaced inside the narrative summary. */
  readonly narrativeFragment?: string;
  /** Tags counted into theme synthesis. */
  readonly tags?: ReadonlyArray<string>;
}

/** Tunables for `accumulateIdentityVector`. */
export interface IdentityAccumulationOptions {
  /** Step size applied to averaged evidence. Defaults to 0.08. */
  readonly evidenceLearningRate?: number;
  /** Weight on `reinforcement` when shaping curiosity. Defaults to 0.4. */
  readonly reinforcementWeight?: number;
  /** Weight on `contradictionRisk` when shaping caution. Defaults to 0.3. */
  readonly contradictionWeight?: number;
}

/** Tunables for `stabilizeIdentityDrift`. */
export interface DriftStabilizationOptions {
  /** Per-trait maximum signed step. Defaults to 0.1. */
  readonly maxTraitStep?: number;
  /** Strength of stability damping, in `[0, 1]`. Defaults to 0.5. */
  readonly stabilityDamping?: number;
}

/**
 * Human-readable self-model produced by the narrative engine. Stored
 * alongside the new `IdentityState` so that operators and the workbench
 * can inspect identity drift without re-running synthesis.
 */
export interface NarrativeSelfModel {
  readonly identityId: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly dominantTraits: ReadonlyArray<IdentityVectorKey>;
  readonly themes: ReadonlyArray<string>;
  readonly coherenceScore: number;
  readonly driftMagnitude: number;
  readonly supportingMemoryIds: ReadonlyArray<string>;
}

export interface IdentityFormationInput {
  readonly previous?: IdentityState;
  readonly evidence: ReadonlyArray<IdentityEvidence>;
  readonly identityId?: string;
  readonly timestamp?: string;
}

export interface IdentityFormationResult {
  readonly previous: IdentityState;
  readonly proposed: IdentityState;
  readonly next: IdentityState;
  readonly selfModel: NarrativeSelfModel;
  readonly event: IdentityUpdateEvent;
}

/** Optional fan-out hook used to broadcast updates on Kafka. */
export interface IdentityUpdatePublisher {
  publish(event: IdentityUpdateEvent): Promise<void>;
}

export interface AutobiographicalEpisode {
  readonly episodeId: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly memoryIds: ReadonlyArray<string>;
  readonly affectTone?: string;
  readonly beliefIds?: ReadonlyArray<string>;
}

export interface IdentityThread {
  readonly threadId: string;
  readonly theme: string;
  readonly episodeIds: ReadonlyArray<string>;
  readonly coherenceScore: number;
  readonly lastUpdated: string;
}

export interface FutureSelfProjection {
  readonly projectionId: string;
  readonly horizon: "short" | "mid" | "long";
  readonly projectedTraits: IdentityState;
  readonly expectedNarrative: string;
  readonly confidence: number;
}

export interface NarrativeRevision {
  readonly revisionId: string;
  readonly revisedAt: string;
  readonly affectedThreadIds: ReadonlyArray<string>;
  readonly reason: string;
  readonly coherenceDelta: number;
}
