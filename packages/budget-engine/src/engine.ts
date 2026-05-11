/**
 * Compute-budget gate.
 *
 * `BudgetEngine` enforces three constraints on every reasoning request:
 *   1. The decision-rule utility (expectedUtility minus cost minus an
 *      uncertainty penalty) must clear `utilityThreshold`.
 *   2. Aggregate exhaustion across token, tool, and latency pressure must
 *      remain below 0.9.
 *   3. The requested tokens and tool calls must fit within the remaining
 *      per-agent quota.
 *
 * When the decision is approved, the engine also classifies the request
 * into `fast` or `slow` mode so that agents can switch between heuristic
 * and deliberative paths. Spend is recorded after each successful run via
 * `recordSpend`, and `reset` clears the per-agent (or all) load state at
 * the end of a window.
 */

import type { AgentType } from "@cognitive-substrate/core-types";
import type {
  BudgetDecision,
  BudgetRequest,
  CognitiveLoadState,
  CognitionMode,
  ComputeQuota,
} from "./types.js";

/** Fallback quota used when no agent-specific quota is registered. */
const DEFAULT_QUOTA: ComputeQuota = {
  agentType: "executor",
  maxTokens: 4_000,
  maxToolCalls: 4,
  maxLatencyMs: 15_000,
  resetIntervalMs: 60_000,
};

export class BudgetEngine {
  private readonly quotas = new Map<AgentType, ComputeQuota>();
  private readonly load = new Map<AgentType, CognitiveLoadState>();
  private readonly utilityThreshold: number;

  constructor(options: {
    readonly quotas?: ReadonlyArray<ComputeQuota>;
    readonly utilityThreshold?: number;
  } = {}) {
    for (const quota of options.quotas ?? []) {
      this.quotas.set(quota.agentType, quota);
    }
    this.utilityThreshold = options.utilityThreshold ?? 0.35;
  }

  /**
   * Evaluates one BudgetRequest against the agent's quota and current load.
   * The decision is returned but not recorded; callers should invoke
   * `recordSpend` once the actual spend is known.
   */
  decide(request: BudgetRequest): BudgetDecision {
    const quota = this.quotaFor(request.agentType);
    const load = this.load.get(request.agentType) ?? emptyLoad();
    const exhaustion = computeExhaustion(load, quota);
    const utility = clamp(request.expectedUtility - request.expectedCost - (request.uncertainty ?? 0) * 0.15);
    const tokenAllowance = Math.max(0, quota.maxTokens - load.spentTokens);
    const toolCallAllowance = Math.max(0, quota.maxToolCalls - load.spentToolCalls);
    const mode = selectMode(utility, exhaustion, request.uncertainty ?? 0);
    const requestedTokens = request.requestedTokens ?? 0;
    const requestedToolCalls = request.requestedToolCalls ?? 0;
    const approved =
      utility >= this.utilityThreshold
      && exhaustion < 0.9
      && requestedTokens <= tokenAllowance
      && requestedToolCalls <= toolCallAllowance;

    return {
      approved,
      mode,
      utility,
      exhaustion,
      tokenAllowance,
      toolCallAllowance,
      reason: approved ? "budget_approved" : rejectionReason(utility, exhaustion),
    };
  }

  /**
   * Records actual spend after an agent completes its work. The recorded
   * exhaustion is used by the next `decide` call for the same agent.
   */
  recordSpend(agentType: AgentType, spentTokens: number, spentToolCalls: number, latencyMs: number): CognitiveLoadState {
    const current = this.load.get(agentType) ?? emptyLoad();
    const quota = this.quotaFor(agentType);
    const next: CognitiveLoadState = {
      spentTokens: current.spentTokens + spentTokens,
      spentToolCalls: current.spentToolCalls + spentToolCalls,
      recentLatencyMs: latencyMs,
      exhaustion: computeExhaustion(
        {
          spentTokens: current.spentTokens + spentTokens,
          spentToolCalls: current.spentToolCalls + spentToolCalls,
          recentLatencyMs: latencyMs,
          exhaustion: current.exhaustion,
        },
        quota,
      ),
    };
    this.load.set(agentType, next);
    return next;
  }

  /**
   * Clears load state. With no argument, resets every agent. Should be
   * driven by an external scheduler aligned with `resetIntervalMs`.
   */
  reset(agentType?: AgentType): void {
    if (agentType) {
      this.load.delete(agentType);
      return;
    }
    this.load.clear();
  }

  private quotaFor(agentType: AgentType): ComputeQuota {
    return this.quotas.get(agentType) ?? { ...DEFAULT_QUOTA, agentType };
  }
}

/**
 * Combined exhaustion across token (45%), tool (35%), and latency (20%)
 * pressure. The weighting reflects the assumption that token spend is the
 * dominant cost driver, with tool calls and latency providing secondary
 * pressure signals.
 */
export function computeExhaustion(load: CognitiveLoadState, quota: ComputeQuota): number {
  const tokenPressure = load.spentTokens / Math.max(1, quota.maxTokens);
  const toolPressure = load.spentToolCalls / Math.max(1, quota.maxToolCalls);
  const latencyPressure = load.recentLatencyMs / Math.max(1, quota.maxLatencyMs);
  return clamp(tokenPressure * 0.45 + toolPressure * 0.35 + latencyPressure * 0.2);
}

/**
 * Picks `slow` mode only when utility is high, uncertainty is non-trivial,
 * and the agent still has headroom. Otherwise the request is served by
 * the fast (heuristic) path so that exhausted or low-stakes requests do
 * not drain remaining budget.
 */
function selectMode(utility: number, exhaustion: number, uncertainty: number): CognitionMode {
  if (utility > 0.65 && uncertainty > 0.35 && exhaustion < 0.7) return "slow";
  return "fast";
}

function rejectionReason(utility: number, exhaustion: number): string {
  if (exhaustion >= 0.9) return "cognitive_exhaustion";
  if (utility < 0.35) return "utility_below_threshold";
  return "quota_exceeded";
}

function emptyLoad(): CognitiveLoadState {
  return {
    spentTokens: 0,
    spentToolCalls: 0,
    recentLatencyMs: 0,
    exhaustion: 0,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
