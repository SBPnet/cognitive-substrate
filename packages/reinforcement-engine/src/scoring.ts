/**
 * Multi-factor reinforcement scoring.
 *
 * `scoreReinforcement` blends seven normalised inputs into a single
 * reinforcement value plus four coupled outputs (decay, retrieval priority,
 * policy delta, identity impact). The weights here are empirical: they
 * were chosen so that no single factor can fully drive the score, while
 * still allowing strong importance, novelty, or policy alignment to
 * dominate when other channels are neutral.
 *
 * Output guarantees:
 *   - reinforcement, decayAdjustment, retrievalPriority   in `[0, 1]`
 *   - policyDelta, identityImpact                          in `[-1, 1]`
 */

import type { ReinforcementResult, ReinforcementSignal } from "@cognitive-substrate/core-types";

/**
 * Computes the reinforcement bundle from a single signal.
 *
 *   - reinforcement       : weighted blend of the seven input channels.
 *   - decayAdjustment     : inverse-shaped so that high reinforcement slows
 *                           decay.
 *   - retrievalPriority   : reinforcement biased by usage frequency and
 *                           goal relevance.
 *   - policyDelta         : signed delta centred on 0.5, scaled to a small
 *                           absolute magnitude so policy drift remains bounded.
 *   - identityImpact      : signed contribution to the identity vector that
 *                           rewards novelty and emotional weight while
 *                           penalising contradiction risk.
 */
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

/**
 * Combined novelty score: 70% raw novelty plus 30% inverse-usage. The
 * inverse-usage term ensures that frequently-retrieved memories do not
 * receive a novelty bonus even when their semantic novelty is high.
 */
function noveltyScore(signal: ReinforcementSignal): number {
  return clamp(signal.novelty * 0.7 + (1 - signal.usageFrequency) * 0.3);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
