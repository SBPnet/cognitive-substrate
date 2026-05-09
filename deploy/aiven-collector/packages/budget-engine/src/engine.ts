import type { AgentType } from "@cognitive-substrate/core-types";
import type {
  BudgetDecision,
  BudgetRequest,
  CognitiveLoadState,
  CognitionMode,
  ComputeQuota,
} from "./types.js";

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

export function computeExhaustion(load: CognitiveLoadState, quota: ComputeQuota): number {
  const tokenPressure = load.spentTokens / Math.max(1, quota.maxTokens);
  const toolPressure = load.spentToolCalls / Math.max(1, quota.maxToolCalls);
  const latencyPressure = load.recentLatencyMs / Math.max(1, quota.maxLatencyMs);
  return clamp(tokenPressure * 0.45 + toolPressure * 0.35 + latencyPressure * 0.2);
}

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
