/**
 * Causal-engine type surface.
 *
 * The causal engine maintains a small structural causal model derived
 * from co-occurrence statistics in the recent experience stream, and
 * supports counterfactual interventions and abstraction (filtering by
 * minimum edge strength). The current implementation is deliberately
 * lightweight; richer causal-discovery algorithms can be plugged in by
 * replacing `inferModel` while keeping the same `CausalEngine` surface.
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";

/** A node in the structural causal model. */
export interface CausalVariable {
  readonly variableId: string;
  readonly label: string;
  readonly value?: number;
}

/** A directed edge representing a hypothesised causal influence. */
export interface CausalEdge {
  readonly sourceId: string;
  readonly targetId: string;
  /** Estimated strength in `[0, 1]`. */
  readonly strength: number;
  /** Confidence in the estimate, in `[0, 1]`. */
  readonly confidence: number;
}

export interface StructuralCausalModel {
  readonly variables: ReadonlyArray<CausalVariable>;
  readonly edges: ReadonlyArray<CausalEdge>;
}

/** "Set X = v" intervention applied during counterfactual reasoning. */
export interface Intervention {
  readonly variableId: string;
  readonly value: number;
}

/** Output of one counterfactual evaluation. */
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
