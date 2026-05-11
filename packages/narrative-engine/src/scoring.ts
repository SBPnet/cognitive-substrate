/**
 * Identity-vector accumulation, drift stabilisation, and coherence scoring.
 *
 * Three constraints govern the math here:
 *
 *   1. Each evidence batch is averaged before being scaled by the
 *      `evidenceLearningRate`, so noisy single-batch swings are damped.
 *   2. Drift is stabilised against the previous state with a per-trait
 *      cap that depends on the existing `stabilityScore`: a more stable
 *      identity is harder to move.
 *   3. Coherence is reported as a single `[0, 1]` value blending
 *      stability, curiosity/caution balance, drift inverse, and
 *      evidence support, with a contradiction penalty.
 */

import type { IdentityState } from "@cognitive-substrate/core-types";
import type {
  DriftStabilizationOptions,
  IdentityAccumulationOptions,
  IdentityDelta,
  IdentityEvidence,
  IdentityVectorKey,
} from "./types.js";

const IDENTITY_VECTOR_KEYS: ReadonlyArray<IdentityVectorKey> = [
  "curiosity",
  "caution",
  "verbosity",
  "toolDependence",
  "explorationPreference",
  "stabilityScore",
];

const DEFAULT_ACCUMULATION_OPTIONS: Required<IdentityAccumulationOptions> = {
  evidenceLearningRate: 0.08,
  reinforcementWeight: 0.4,
  contradictionWeight: 0.3,
};

const DEFAULT_STABILIZATION_OPTIONS: Required<DriftStabilizationOptions> = {
  maxTraitStep: 0.1,
  stabilityDamping: 0.5,
};

interface IdentityVectorTotals {
  readonly curiosity: number;
  readonly caution: number;
  readonly verbosity: number;
  readonly toolDependence: number;
  readonly explorationPreference: number;
  readonly stabilityScore: number;
}

/**
 * Returns a neutral starting identity. All trait dimensions are set to
 * 0.5 except `stabilityScore`, which starts at 0.65 so that the engine
 * resists moving on the very first evidence batch.
 */
export function createDefaultIdentityState(
  identityId: string = "default-identity",
  timestamp: string = new Date().toISOString(),
): IdentityState {
  return {
    identityId,
    timestamp,
    curiosity: 0.5,
    caution: 0.5,
    verbosity: 0.5,
    toolDependence: 0.5,
    explorationPreference: 0.5,
    stabilityScore: 0.65,
  };
}

/**
 * Folds a batch of evidence into the previous identity state. The
 * average per-batch delta is scaled by `evidenceLearningRate` so that no
 * single batch can saturate any dimension.
 */
export function accumulateIdentityVector(
  previous: IdentityState,
  evidence: ReadonlyArray<IdentityEvidence>,
  timestamp: string = new Date().toISOString(),
  options: IdentityAccumulationOptions = {},
): IdentityState {
  const resolvedOptions = { ...DEFAULT_ACCUMULATION_OPTIONS, ...options };
  const averageDelta = averageEvidenceDelta(evidence, resolvedOptions);

  return {
    identityId: previous.identityId,
    timestamp,
    curiosity: clamp(previous.curiosity + averageDelta.curiosity),
    caution: clamp(previous.caution + averageDelta.caution),
    verbosity: clamp(previous.verbosity + averageDelta.verbosity),
    toolDependence: clamp(previous.toolDependence + averageDelta.toolDependence),
    explorationPreference: clamp(
      previous.explorationPreference + averageDelta.explorationPreference,
    ),
    stabilityScore: clamp(previous.stabilityScore + averageDelta.stabilityScore),
  };
}

/**
 * Caps per-trait drift between the previous state and the proposed
 * state. The effective cap is `maxTraitStep * (1 - stabilityScore *
 * stabilityDamping)`, so a highly stable identity can only move by a
 * small fraction of `maxTraitStep` per cycle.
 */
export function stabilizeIdentityDrift(
  previous: IdentityState,
  proposed: IdentityState,
  options: DriftStabilizationOptions = {},
): IdentityState {
  const resolvedOptions = { ...DEFAULT_STABILIZATION_OPTIONS, ...options };
  const maxStep =
    resolvedOptions.maxTraitStep
    * (1 - previous.stabilityScore * resolvedOptions.stabilityDamping);

  return {
    identityId: proposed.identityId,
    timestamp: proposed.timestamp,
    curiosity: stabilizeTrait(previous.curiosity, proposed.curiosity, maxStep),
    caution: stabilizeTrait(previous.caution, proposed.caution, maxStep),
    verbosity: stabilizeTrait(previous.verbosity, proposed.verbosity, maxStep),
    toolDependence: stabilizeTrait(previous.toolDependence, proposed.toolDependence, maxStep),
    explorationPreference: stabilizeTrait(
      previous.explorationPreference,
      proposed.explorationPreference,
      maxStep,
    ),
    stabilityScore: stabilizeTrait(previous.stabilityScore, proposed.stabilityScore, maxStep),
  };
}

export function identityDelta(
  previous: IdentityState,
  next: IdentityState,
): IdentityDelta {
  return {
    curiosity: signedDelta(previous.curiosity, next.curiosity),
    caution: signedDelta(previous.caution, next.caution),
    verbosity: signedDelta(previous.verbosity, next.verbosity),
    toolDependence: signedDelta(previous.toolDependence, next.toolDependence),
    explorationPreference: signedDelta(
      previous.explorationPreference,
      next.explorationPreference,
    ),
    stabilityScore: signedDelta(previous.stabilityScore, next.stabilityScore),
  };
}

/** Root-mean-square difference between two identity vectors, in `[0, 1]`. */
export function driftMagnitude(previous: IdentityState, next: IdentityState): number {
  const squaredDistance = IDENTITY_VECTOR_KEYS.reduce(
    (sum, key) => sum + Math.pow(next[key] - previous[key], 2),
    0,
  );
  return clamp(Math.sqrt(squaredDistance / IDENTITY_VECTOR_KEYS.length));
}

/**
 * Combined coherence score in `[0, 1]`. Weights:
 *
 *   - stabilityScore           : 35%
 *   - curiosity/caution balance: 25%
 *   - inverse drift magnitude  : 25%
 *   - evidence support         : 15%
 *   - contradiction penalty    : up to 25% subtracted directly
 */
export function scoreIdentityCoherence(
  previous: IdentityState,
  next: IdentityState,
  evidence: ReadonlyArray<IdentityEvidence>,
): number {
  const drift = driftMagnitude(previous, next);
  const balance = 1 - Math.abs(next.curiosity - next.caution);
  const evidenceSupport = Math.min(1, evidence.length / 8);
  const contradictionPenalty = averageContradictionRisk(evidence) * 0.25;

  return clamp(
    next.stabilityScore * 0.35
      + balance * 0.25
      + (1 - drift) * 0.25
      + evidenceSupport * 0.15
      - contradictionPenalty,
  );
}

export function dominantIdentityTraits(
  identity: IdentityState,
  limit: number = 3,
): ReadonlyArray<IdentityVectorKey> {
  return [...IDENTITY_VECTOR_KEYS]
    .sort((left, right) => identity[right] - identity[left])
    .slice(0, limit);
}

function averageEvidenceDelta(
  evidence: ReadonlyArray<IdentityEvidence>,
  options: Required<IdentityAccumulationOptions>,
): IdentityVectorTotals {
  const seed: IdentityVectorTotals = {
    curiosity: 0,
    caution: 0,
    verbosity: 0,
    toolDependence: 0,
    explorationPreference: 0,
    stabilityScore: 0,
  };

  if (evidence.length === 0) return seed;

  const accumulated = evidence.reduce<IdentityVectorTotals>((sum, item) => {
    const reinforcement = item.reinforcement ?? 0;
    const contradictionRisk = item.contradictionRisk ?? 0;

    return {
      curiosity:
        sum.curiosity
        + (item.curiosityDelta ?? 0)
        + reinforcement * options.reinforcementWeight,
      caution:
        sum.caution
        + (item.cautionDelta ?? 0)
        + contradictionRisk * options.contradictionWeight,
      verbosity: sum.verbosity + (item.verbosityDelta ?? 0),
      toolDependence: sum.toolDependence + (item.toolDependenceDelta ?? 0),
      explorationPreference:
        sum.explorationPreference
        + (item.explorationPreferenceDelta ?? 0)
        + (item.curiosityDelta ?? 0) * 0.5,
      stabilityScore:
        sum.stabilityScore
        + (item.stabilityDelta ?? 0)
        - contradictionRisk * options.contradictionWeight,
    };
  }, seed);

  return {
    curiosity: scaleDelta(accumulated.curiosity, evidence.length, options.evidenceLearningRate),
    caution: scaleDelta(accumulated.caution, evidence.length, options.evidenceLearningRate),
    verbosity: scaleDelta(accumulated.verbosity, evidence.length, options.evidenceLearningRate),
    toolDependence: scaleDelta(
      accumulated.toolDependence,
      evidence.length,
      options.evidenceLearningRate,
    ),
    explorationPreference: scaleDelta(
      accumulated.explorationPreference,
      evidence.length,
      options.evidenceLearningRate,
    ),
    stabilityScore: scaleDelta(
      accumulated.stabilityScore,
      evidence.length,
      options.evidenceLearningRate,
    ),
  };
}

function stabilizeTrait(previous: number, proposed: number, maxStep: number): number {
  return clamp(previous + clampSigned(proposed - previous, maxStep));
}

function scaleDelta(total: number, count: number, learningRate: number): number {
  return clampSigned((total / count) * learningRate, learningRate);
}

function signedDelta(previous: number, next: number): number {
  return clampSigned(next - previous, 1);
}

function averageContradictionRisk(evidence: ReadonlyArray<IdentityEvidence>): number {
  if (evidence.length === 0) return 0;
  const total = evidence.reduce((sum, item) => sum + (item.contradictionRisk ?? 0), 0);
  return clamp(total / evidence.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
