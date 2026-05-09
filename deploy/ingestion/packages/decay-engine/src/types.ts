import type { MemoryLink, MemoryReference } from "@cognitive-substrate/core-types";

export type ForgettingAction = "retain" | "suppress" | "compress" | "retire" | "prune";

export interface ForgettingCandidate {
  readonly memory: MemoryReference;
  readonly retrievalCount: number;
  readonly contradictionScore?: number;
  readonly ageDays?: number;
  readonly strategicValue?: number;
}

export interface ForgettingDecision {
  readonly memoryId: string;
  readonly action: ForgettingAction;
  readonly suppressionWeight: number;
  readonly retentionScore: number;
  readonly reason: string;
}

export interface CompressionCluster {
  readonly clusterId: string;
  readonly memoryIds: ReadonlyArray<string>;
  readonly compressionPriority: number;
  readonly summaryHint: string;
}

export interface GraphPruningResult {
  readonly retainedLinks: ReadonlyArray<MemoryLink>;
  readonly prunedLinks: ReadonlyArray<MemoryLink>;
}

export interface ForgettingPlan {
  readonly decisions: ReadonlyArray<ForgettingDecision>;
  readonly compressionClusters: ReadonlyArray<CompressionCluster>;
  readonly graphPruning?: GraphPruningResult;
}
