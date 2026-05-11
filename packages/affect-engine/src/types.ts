/**
 * Affect-engine type surface.
 *
 * Affect is treated as a slow-moving modulation signal that biases attention
 * and consolidation, not as an emotional state in any biological sense. The
 * neurochemical names are computational analogies for naming dimensions.
 *
 *   - dopamine             : reward-prediction signal
 *   - norepinephrine       : urgency / arousal under uncertainty
 *   - serotonin            : sustained-success baseline
 *   - curiosity            : novelty-seeking drive
 *   - contradictionStress  : cost of holding inconsistent beliefs
 */

import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";

/** Coarse categorical classification of the current AffectVector. */
export type MoodState = "settled" | "curious" | "stressed" | "cautious" | "exploratory";

/**
 * One observation feeding the affect update step. All values are
 * normalised to roughly `[0, 1]` (rewardPredictionError may be signed).
 */
export interface AffectSignal {
  readonly rewardPredictionError: number;
  readonly novelty: number;
  readonly uncertainty: number;
  readonly contradictionRisk: number;
  /** Smoothed success rate over recent interactions. */
  readonly sustainedSuccess?: number;
}

/** The five-dimensional affect vector, all components in `[0, 1]`. */
export interface AffectVector {
  readonly dopamine: number;
  readonly norepinephrine: number;
  readonly serotonin: number;
  readonly curiosity: number;
  readonly contradictionStress: number;
}

/** Snapshot of the affect engine at a point in time. */
export interface AffectState {
  readonly timestamp: string;
  readonly vector: AffectVector;
  readonly mood: MoodState;
}

/**
 * Result of coupling the affect vector to a single AttentionCandidate.
 * The original candidate is preserved alongside the boost so that callers
 * can attribute the salience change in traces.
 */
export interface AttentionAffectCoupling {
  readonly candidateId: string;
  /** Additive salience contribution drawn from the current affect vector. */
  readonly affectBoost: number;
  /** Candidate with `importance` already increased by `affectBoost`. */
  readonly adjustedCandidate: AttentionCandidate;
}
