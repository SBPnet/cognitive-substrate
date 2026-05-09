import type { IdentityState, PolicyState, ReinforcementSignal, SelfModificationProposal } from "@cognitive-substrate/core-types";

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
