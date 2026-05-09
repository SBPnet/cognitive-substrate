import type { ExperienceEvent } from "@cognitive-substrate/core-types";

export interface CausalVariable {
  readonly variableId: string;
  readonly label: string;
  readonly value?: number;
}

export interface CausalEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly strength: number;
  readonly confidence: number;
}

export interface StructuralCausalModel {
  readonly variables: ReadonlyArray<CausalVariable>;
  readonly edges: ReadonlyArray<CausalEdge>;
}

export interface Intervention {
  readonly variableId: string;
  readonly value: number;
}

export interface CounterfactualResult {
  readonly targetId: string;
  readonly baseline: number;
  readonly counterfactual: number;
  readonly effect: number;
  readonly confidence: number;
}

export interface CausalInferenceInput {
  readonly events: ReadonlyArray<ExperienceEvent>;
  readonly variables: ReadonlyArray<CausalVariable>;
}
