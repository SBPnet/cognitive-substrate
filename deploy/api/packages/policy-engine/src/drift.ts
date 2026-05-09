import type { PolicyState } from "@cognitive-substrate/core-types";
import type {
  PolicyDelta,
  PolicyEvaluationInput,
  PolicyVectorKey,
} from "./types.js";

const MAX_ABSOLUTE_DRIFT = 0.08;

export function computePolicyDelta(input: PolicyEvaluationInput): PolicyDelta {
  const reward = clampSigned(input.rewardDelta);
  const confidence = input.confidence ?? 0.5;
  const contradictionRisk = input.contradictionRisk ?? 0;
  const memoryUsefulness = input.memoryUsefulness ?? 0.5;
  const toolUsefulness = input.toolUsefulness ?? 0.5;
  const goalProgress = input.goalProgress ?? 0.5;

  return clampDelta({
    retrievalBias: reward * (memoryUsefulness - 0.5) * 0.18,
    memoryTrust: reward * (memoryUsefulness - contradictionRisk) * 0.12,
    toolBias: reward * (toolUsefulness - 0.5) * 0.16,
    riskTolerance: reward * (confidence - contradictionRisk - 0.25) * 0.1,
    explorationFactor: reward * (0.5 - confidence + contradictionRisk) * 0.08,
    goalPersistence: reward * (goalProgress - 0.5) * 0.12,
    workingMemoryDecayRate: -reward * (memoryUsefulness - 0.5) * 0.08,
  });
}

export function applyPolicyDelta(
  current: PolicyState,
  delta: PolicyDelta,
  nextVersion: string,
  timestamp: string = new Date().toISOString(),
): PolicyState {
  return {
    version: nextVersion,
    timestamp,
    retrievalBias: applyDelta(current.retrievalBias, delta.retrievalBias),
    toolBias: applyDelta(current.toolBias, delta.toolBias),
    riskTolerance: applyDelta(current.riskTolerance, delta.riskTolerance),
    memoryTrust: applyDelta(current.memoryTrust, delta.memoryTrust),
    explorationFactor: applyDelta(current.explorationFactor, delta.explorationFactor),
    goalPersistence: applyDelta(current.goalPersistence, delta.goalPersistence),
    workingMemoryDecayRate: applyDelta(
      current.workingMemoryDecayRate,
      delta.workingMemoryDecayRate,
    ),
  };
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function applyDelta(current: number, delta: number | undefined): number {
  return clampUnit(current + (delta ?? 0));
}

function clampDelta(delta: Required<PolicyDelta>): PolicyDelta {
  return Object.fromEntries(
    Object.entries(delta).map(([key, value]) => [
      key,
      Math.max(-MAX_ABSOLUTE_DRIFT, Math.min(MAX_ABSOLUTE_DRIFT, value)),
    ]),
  ) as Record<PolicyVectorKey, number>;
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
