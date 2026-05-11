/**
 * Budget-engine type surface.
 *
 * The budget engine enforces compute scarcity. Every reasoning attempt
 * passes through a `BudgetEngine.decide` call that compares the agent's
 * accumulated load against its quota and the request's expected utility.
 * Decisions also carry a `CognitionMode` ("fast" or "slow") that downstream
 * agents can read to switch between heuristic and deliberative paths.
 */

import type { AgentType } from "@cognitive-substrate/core-types";

/**
 * Reasoning mode chosen for the current request.
 *
 *   - `fast`: cheap, heuristic, low-confidence path
 *   - `slow`: deliberative, multi-step, higher-cost path
 */
export type CognitionMode = "fast" | "slow";

/** Per-agent quota over a single reset window. */
export interface ComputeQuota {
  readonly agentType: AgentType;
  readonly maxTokens: number;
  readonly maxToolCalls: number;
  readonly maxLatencyMs: number;
  /** Window length after which the engine should call `reset()`. */
  readonly resetIntervalMs: number;
}

/** One request for compute, made before an agent begins reasoning. */
export interface BudgetRequest {
  readonly agentType: AgentType;
  /** Caller's estimate of the value of completing this request, in `[0, 1]`. */
  readonly expectedUtility: number;
  /** Caller's estimate of the cost, in the same units as utility. */
  readonly expectedCost: number;
  /** Caller's estimate of how unsure it is about the utility, in `[0, 1]`. */
  readonly uncertainty?: number;
  readonly requestedTokens?: number;
  readonly requestedToolCalls?: number;
}

/** Result of one budget evaluation. */
export interface BudgetDecision {
  readonly approved: boolean;
  readonly mode: CognitionMode;
  /** `expectedUtility - expectedCost - 0.15 * uncertainty`, clamped. */
  readonly utility: number;
  /** Aggregate exhaustion across token, tool, and latency pressure, in `[0, 1]`. */
  readonly exhaustion: number;
  readonly tokenAllowance: number;
  readonly toolCallAllowance: number;
  /** Machine-readable reason code suitable for logging and tracing. */
  readonly reason: string;
}

/**
 * Cached result of a deterministic-or-near-deterministic computation.
 * Returned to the caller from `HeuristicCache.set` so that the cache can
 * also serve as the source of truth for utility-based eviction.
 */
export interface HeuristicCacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly utility: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Running accumulators tracked per agent inside the budget engine. */
export interface CognitiveLoadState {
  readonly spentTokens: number;
  readonly spentToolCalls: number;
  readonly recentLatencyMs: number;
  /** Aggregate exhaustion derived from the three pressure ratios. */
  readonly exhaustion: number;
}
