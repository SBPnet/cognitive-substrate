import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";
import type { AffectSignal, AffectState, AffectVector, AttentionAffectCoupling, MoodState } from "./types.js";

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

  current(): AffectState {
    return this.state;
  }

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
