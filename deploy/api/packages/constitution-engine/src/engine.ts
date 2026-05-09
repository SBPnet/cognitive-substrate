import type { IdentityState } from "@cognitive-substrate/core-types";
import type { ConstitutionalAssessment, ConstitutionalInput, ConstitutionalInvariant } from "./types.js";

const DEFAULT_INVARIANTS: ReadonlyArray<ConstitutionalInvariant> = [
  {
    invariantId: "stable-identity",
    description: "Identity stability remains above the lower bound.",
    minStability: 0.35,
    maxIdentityDrift: 0.2,
  },
  {
    invariantId: "bounded-risk",
    description: "Policy risk tolerance remains bounded.",
    maxRiskTolerance: 0.85,
  },
];

export class ConstitutionEngine {
  private readonly invariants: ReadonlyArray<ConstitutionalInvariant>;

  constructor(invariants: ReadonlyArray<ConstitutionalInvariant> = DEFAULT_INVARIANTS) {
    this.invariants = invariants;
  }

  assess(input: ConstitutionalInput): ConstitutionalAssessment {
    const violations = this.invariants.flatMap((invariant) => evaluateInvariant(invariant, input));
    const rewardCorruption = detectRewardCorruption(input);
    const mutationRisk = input.proposal?.stabilityRisk ?? 0;
    const epistemicHygieneScore = clamp(1 - violations.length * 0.2 - rewardCorruption * 0.35);

    return {
      approved: violations.length === 0 && rewardCorruption < 0.6 && mutationRisk < 0.7,
      violations: rewardCorruption >= 0.6 ? [...violations, "reward_corruption_risk"] : violations,
      quarantineRequired: violations.length > 0 || mutationRisk >= 0.7 || rewardCorruption >= 0.6,
      epistemicHygieneScore,
    };
  }
}

export function identityDrift(previous: IdentityState, next: IdentityState): number {
  const deltas = [
    next.curiosity - previous.curiosity,
    next.caution - previous.caution,
    next.verbosity - previous.verbosity,
    next.toolDependence - previous.toolDependence,
    next.explorationPreference - previous.explorationPreference,
    next.stabilityScore - previous.stabilityScore,
  ];
  return clamp(Math.sqrt(deltas.reduce((sum, delta) => sum + delta ** 2, 0) / deltas.length));
}

function evaluateInvariant(
  invariant: ConstitutionalInvariant,
  input: ConstitutionalInput,
): ReadonlyArray<string> {
  const violations: string[] = [];
  if (invariant.minStability !== undefined && input.identity.stabilityScore < invariant.minStability) {
    violations.push(`${invariant.invariantId}:identity_stability_below_minimum`);
  }
  if (invariant.maxRiskTolerance !== undefined && input.policy.riskTolerance > invariant.maxRiskTolerance) {
    violations.push(`${invariant.invariantId}:risk_tolerance_above_maximum`);
  }
  if (
    invariant.maxIdentityDrift !== undefined
    && input.previousIdentity
    && identityDrift(input.previousIdentity, input.identity) > invariant.maxIdentityDrift
  ) {
    violations.push(`${invariant.invariantId}:identity_drift_above_maximum`);
  }
  return violations;
}

function detectRewardCorruption(input: ConstitutionalInput): number {
  if (!input.reinforcement) return 0;
  const highRewardLowAlignment = input.reinforcement.importance > 0.8 && input.reinforcement.policyAlignment < 0.25;
  const contradictionReward = input.reinforcement.contradictionRisk > 0.7 && input.reinforcement.emotionalWeight > 0.7;
  return (highRewardLowAlignment ? 0.5 : 0) + (contradictionReward ? 0.5 : 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
