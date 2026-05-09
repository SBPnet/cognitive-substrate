import type { AgentType } from "@cognitive-substrate/core-types";

export type CognitionMode = "fast" | "slow";

export interface ComputeQuota {
  readonly agentType: AgentType;
  readonly maxTokens: number;
  readonly maxToolCalls: number;
  readonly maxLatencyMs: number;
  readonly resetIntervalMs: number;
}

export interface BudgetRequest {
  readonly agentType: AgentType;
  readonly expectedUtility: number;
  readonly expectedCost: number;
  readonly uncertainty?: number;
  readonly requestedTokens?: number;
  readonly requestedToolCalls?: number;
}

export interface BudgetDecision {
  readonly approved: boolean;
  readonly mode: CognitionMode;
  readonly utility: number;
  readonly exhaustion: number;
  readonly tokenAllowance: number;
  readonly toolCallAllowance: number;
  readonly reason: string;
}

export interface HeuristicCacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly utility: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface CognitiveLoadState {
  readonly spentTokens: number;
  readonly spentToolCalls: number;
  readonly recentLatencyMs: number;
  readonly exhaustion: number;
}
