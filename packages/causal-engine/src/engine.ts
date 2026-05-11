/**
 * Structural causal model construction and intervention.
 *
 * The current implementation infers edges from text co-occurrence in
 * recent experience events: if two variable labels frequently appear in
 * the same event text, an edge is added with strength proportional to
 * the joint mention rate. This is a placeholder for a real causal
 * discovery algorithm; the public surface stays the same so that
 * downstream callers do not need to change when the implementation is
 * swapped.
 */

import type {
  CausalEdge,
  CausalInferenceInput,
  CausalVariable,
  CounterfactualResult,
  Intervention,
  StructuralCausalModel,
} from "./types.js";

export class CausalEngine {
  /**
   * Builds a directed graph over the supplied variables. Edge strength
   * is the joint mention count divided by the larger of the two
   * marginal counts; edge confidence rises with the size of the input
   * window, saturating at 10 events.
   */
  inferModel(input: CausalInferenceInput): StructuralCausalModel {
    const edges: CausalEdge[] = [];
    for (const source of input.variables) {
      for (const target of input.variables) {
        if (source.variableId === target.variableId) continue;
        const strength = inferDependencyStrength(source, target, input);
        if (strength > 0) {
          edges.push({
            sourceId: source.variableId,
            targetId: target.variableId,
            strength,
            confidence: Math.min(1, input.events.length / 10),
          });
        }
      }
    }
    return { variables: input.variables, edges };
  }

  /**
   * Estimates the effect of `do(intervention)` on `targetId`. The
   * counterfactual aggregates the strength of every direct edge from
   * the intervened variable to the target. Indirect (path-based)
   * effects are not modelled in the current implementation.
   */
  intervene(
    model: StructuralCausalModel,
    intervention: Intervention,
    targetId: string,
  ): CounterfactualResult {
    const target = model.variables.find((variable) => variable.variableId === targetId);
    const baseline = target?.value ?? 0;
    const incoming = model.edges.filter(
      (edge) => edge.sourceId === intervention.variableId && edge.targetId === targetId,
    );
    const effect = incoming.reduce((sum, edge) => sum + edge.strength * intervention.value, 0);
    const confidence = incoming.reduce((max, edge) => Math.max(max, edge.confidence), 0);

    return {
      targetId,
      baseline,
      counterfactual: baseline + effect,
      effect,
      confidence,
    };
  }

  /**
   * Returns a thresholded copy of the model containing only edges with
   * strength at or above `minStrength`. Useful for handing the model
   * to higher-level engines that should only see well-supported
   * causal links.
   */
  abstract(model: StructuralCausalModel, minStrength: number = 0.35): StructuralCausalModel {
    return {
      variables: model.variables,
      edges: model.edges.filter((edge) => edge.strength >= minStrength),
    };
  }
}

function inferDependencyStrength(
  source: CausalVariable,
  target: CausalVariable,
  input: CausalInferenceInput,
): number {
  const sourceMentions = mentionCount(source.label, input);
  const targetMentions = mentionCount(target.label, input);
  const jointMentions = input.events.filter((event) =>
    event.input.text.toLowerCase().includes(source.label.toLowerCase())
    && event.input.text.toLowerCase().includes(target.label.toLowerCase()),
  ).length;
  if (sourceMentions === 0 || targetMentions === 0) return 0;
  return clamp(jointMentions / Math.max(sourceMentions, targetMentions));
}

function mentionCount(label: string, input: CausalInferenceInput): number {
  const normalized = label.toLowerCase();
  return input.events.filter((event) => event.input.text.toLowerCase().includes(normalized)).length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
