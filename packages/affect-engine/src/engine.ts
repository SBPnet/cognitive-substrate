/**
 * Affect-vector update engine.
 *
 * The engine maintains a single AffectState. `update()` blends the prior
 * vector with the latest AffectSignal using fixed exponential weights; this
 * provides smoothing against single-step noise while still tracking longer
 * trends. `coupleAttention()` projects the current vector onto an
 * AttentionCandidate, producing a small additive importance boost that the
 * attention engine consumes.
 */

import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";
import type { AffectSignal, AffectState, AffectVector, AttentionAffectCoupling, MoodState } from "./types.js";

/**
 * Neutral starting point: balanced dopamine and serotonin, low
 * norepinephrine and contradictionStress, mid-range curiosity.
 */
const BASE_VECTOR: AffectVector = {
  dopamine: 0.5,
  norepinephrine: 0.35,
  serotonin: 0.6,
  curiosity: 0.5,
  contradictionStress: 0.2,
};

export class AffectEngine {
  private state: AffectState;

  constructor(initialState?: AffectState) {
    this.state = initialState ?? {
      timestamp: new Date().toISOString(),
      vector: BASE_VECTOR,
      mood: "settled",
    };
  }

  /**
   * Folds a new AffectSignal into the current state. The blend weights
   * are tuned so that dopamine reacts fastest to reward signals,
   * serotonin moves slowest, and contradictionStress integrates the
   * contradiction-risk channel almost directly.
   */
  update(signal: AffectSignal): AffectState {
    const vector: AffectVector = {
      dopamine: clamp(this.state.vector.dopamine * 0.7 + positive(signal.rewardPredictionError) * 0.3),
      norepinephrine: clamp(this.state.vector.norepinephrine * 0.65 + signal.uncertainty * 0.2 + signal.contradictionRisk * 0.15),
      serotonin: clamp(this.state.vector.serotonin * 0.75 + (signal.sustainedSuccess ?? 0.5) * 0.25 - signal.contradictionRisk * 0.1),
      curiosity: clamp(this.state.vector.curiosity * 0.6 + signal.novelty * 0.3 + signal.uncertainty * 0.1),
      contradictionStress: clamp(this.state.vector.contradictionStress * 0.6 + signal.contradictionRisk * 0.4),
    };
    this.state = {
      timestamp: new Date().toISOString(),
      vector,
      mood: classifyMood(vector),
    };
    return this.state;
  }

  /** Returns the latest snapshot without mutating it. */
  current(): AffectState {
    return this.state;
  }

  /**
   * Projects the current affect vector onto a candidate, producing an
   * additive importance boost. Curiosity reinforces novelty, norepinephrine
   * reinforces urgency, and contradictionStress reinforces risk. The
   * resulting boost is small by design (capped to `[0, 1]`) so that affect
   * biases attention without dominating the static feature scores.
   */
  coupleAttention(candidate: AttentionCandidate): AttentionAffectCoupling {
    const affectBoost = clamp(
      this.state.vector.curiosity * (candidate.novelty ?? 0.5) * 0.15
        + this.state.vector.norepinephrine * (candidate.urgency ?? 0.5) * 0.12
        + this.state.vector.contradictionStress * (candidate.risk ?? 0) * 0.18,
    );
    return {
      candidateId: candidate.candidateId,
      affectBoost,
      adjustedCandidate: {
        ...candidate,
        importance: clamp(candidate.importance + affectBoost),
      },
    };
  }
}

/**
 * Maps the AffectVector onto a coarse MoodState. Thresholds are stacked
 * so that more severe states (stressed, cautious) take precedence over
 * lighter ones (curious, exploratory, settled).
 */
export function classifyMood(vector: AffectVector): MoodState {
  if (vector.contradictionStress > 0.65) return "stressed";
  if (vector.norepinephrine > 0.7) return "cautious";
  if (vector.curiosity > 0.7) return "curious";
  if (vector.dopamine > 0.65 && vector.serotonin > 0.55) return "exploratory";
  return "settled";
}

function positive(value: number): number {
  return Math.max(0, value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
