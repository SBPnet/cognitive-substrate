import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";

export type MoodState = "settled" | "curious" | "stressed" | "cautious" | "exploratory";

export interface AffectSignal {
  readonly rewardPredictionError: number;
  readonly novelty: number;
  readonly uncertainty: number;
  readonly contradictionRisk: number;
  readonly sustainedSuccess?: number;
}

export interface AffectVector {
  readonly dopamine: number;
  readonly norepinephrine: number;
  readonly serotonin: number;
  readonly curiosity: number;
  readonly contradictionStress: number;
}

export interface AffectState {
  readonly timestamp: string;
  readonly vector: AffectVector;
  readonly mood: MoodState;
}

export interface AttentionAffectCoupling {
  readonly candidateId: string;
  readonly affectBoost: number;
  readonly adjustedCandidate: AttentionCandidate;
}
