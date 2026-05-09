import type { ReinforcementResult, ReinforcementSignal } from "@cognitive-substrate/core-types";

export function scoreReinforcement(signal: ReinforcementSignal): ReinforcementResult {
  const reinforcement = clamp(
    signal.importance * 0.18
      + noveltyScore(signal) * 0.16
      + signal.predictionAccuracy * 0.14
      + signal.emotionalWeight * 0.12
      + signal.goalRelevance * 0.14
      + signal.policyAlignment * 0.16
      + (1 - signal.contradictionRisk) * 0.1,
  );

  return {
    reinforcement,
    decayAdjustment: clamp(1 - reinforcement * 0.65),
    retrievalPriority: clamp(
      reinforcement * 0.7 + signal.usageFrequency * 0.15 + signal.goalRelevance * 0.15,
    ),
    policyDelta: clampSigned((reinforcement - 0.5) * 0.2),
    identityImpact: clampSigned(
      signal.novelty * 0.25 + signal.emotionalWeight * 0.2 - signal.contradictionRisk * 0.3,
    ),
  };
}

function noveltyScore(signal: ReinforcementSignal): number {
  return clamp(signal.novelty * 0.7 + (1 - signal.usageFrequency) * 0.3);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
