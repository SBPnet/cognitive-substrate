/**
 * Constitution-engine type surface.
 *
 * The constitution engine is the gate that decides whether a proposed
 * change to identity, policy, or behaviour can be applied. It evaluates
 * invariants (stability, risk-tolerance, identity-drift) and watches
 * for reward-corruption signatures (reward shaped by contradiction).
 * Violations either reject the change outright or quarantine it until
 * an operator reviews the assessment.
 */

import type { IdentityState, PolicyState, ReinforcementSignal, SelfModificationProposal } from "@cognitive-substrate/core-types";

/**
 * One named invariant. Empty optional fields are skipped during
 * evaluation, so callers only configure the bounds they care about.
 */
export interface ConstitutionalInvariant {
  readonly invariantId: string;
  readonly description: string;
  readonly minStability?: number;
  readonly maxRiskTolerance?: number;
  readonly maxIdentityDrift?: number;
}

export interface ConstitutionalAssessment {
  readonly approved: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly quarantineRequired: boolean;
  readonly epistemicHygieneScore: number;
}

export interface ConstitutionalInput {
  readonly policy: PolicyState;
  readonly identity: IdentityState;
  readonly previousIdentity?: IdentityState;
  readonly proposal?: SelfModificationProposal;
  readonly reinforcement?: ReinforcementSignal;
}
