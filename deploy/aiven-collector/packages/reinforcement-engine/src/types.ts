import type { MemoryIndex, ReinforcementResult, ReinforcementSignal } from "@cognitive-substrate/core-types";
import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";

export interface ReinforcementInput {
  readonly memoryId: string;
  readonly memoryIndex: Extract<MemoryIndex, "experience_events" | "memory_semantic">;
  readonly signal: ReinforcementSignal;
}

export interface ReinforcementUpdate {
  readonly memoryId: string;
  readonly memoryIndex: ReinforcementInput["memoryIndex"];
  readonly result: ReinforcementResult;
  readonly policyVote: PolicyEvaluationInput;
  readonly identityImpact: IdentityImpactSignal;
}

export interface IdentityImpactSignal {
  readonly sourceMemoryId: string;
  readonly curiosityDelta: number;
  readonly cautionDelta: number;
  readonly stabilityDelta: number;
}
