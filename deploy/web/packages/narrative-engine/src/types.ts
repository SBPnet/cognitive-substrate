import type { IdentityState, IdentityUpdateEvent } from "@cognitive-substrate/core-types";

export type IdentityVectorKey = Exclude<keyof IdentityState, "identityId" | "timestamp">;

export type IdentityDelta = Partial<Record<IdentityVectorKey, number>>;

export interface IdentityEvidence {
  readonly sourceMemoryId: string;
  readonly timestamp?: string;
  readonly curiosityDelta?: number;
  readonly cautionDelta?: number;
  readonly verbosityDelta?: number;
  readonly toolDependenceDelta?: number;
  readonly explorationPreferenceDelta?: number;
  readonly stabilityDelta?: number;
  readonly reinforcement?: number;
  readonly contradictionRisk?: number;
  readonly narrativeFragment?: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface IdentityAccumulationOptions {
  readonly evidenceLearningRate?: number;
  readonly reinforcementWeight?: number;
  readonly contradictionWeight?: number;
}

export interface DriftStabilizationOptions {
  readonly maxTraitStep?: number;
  readonly stabilityDamping?: number;
}

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
