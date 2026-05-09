import type { SemanticMemory } from "@cognitive-substrate/core-types";

export interface ConsolidationRequest {
  readonly requestId: string;
  readonly timestamp: string;
  readonly maxAge: string;
  readonly size?: number;
  readonly minImportance?: number;
}

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

export interface ConsolidationDraft {
  readonly summary: string;
  readonly generalization: string;
  readonly embedding: ReadonlyArray<number>;
  readonly semanticCluster?: string;
}

export interface ConsolidationModel {
  generate(candidates: ReadonlyArray<ReplayCandidate>): Promise<ConsolidationDraft>;
}

export interface ConsolidationResult {
  readonly requestId: string;
  readonly timestamp: string;
  readonly semanticMemory: SemanticMemory;
  readonly sourceEventIds: ReadonlyArray<string>;
}

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
