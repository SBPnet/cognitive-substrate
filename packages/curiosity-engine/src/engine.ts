/**
 * Curiosity-driven exploration engine.
 *
 * `CuriosityEngine.assess` ranks candidate states by combined information
 * gain, novelty, uncertainty, and an "unexplored" bonus that decays with
 * `visitedCount`. It then proposes up to five experiments around the
 * top-ranked states. The top priority is also surfaced as
 * `curiosityReward` so that the affect engine can pick it up directly
 * without re-running the priority computation.
 */

import { randomUUID } from "node:crypto";
import type { CuriosityAssessment, CuriosityState, ExperimentPlan } from "./types.js";

export class CuriosityEngine {
  assess(states: ReadonlyArray<CuriosityState>): CuriosityAssessment {
    const prioritizedStates = [...states].sort(
      (left, right) => curiosityPriority(right) - curiosityPriority(left),
    );
    const experiments = prioritizedStates.slice(0, 5).map(planExperiment);
    return {
      curiosityReward: prioritizedStates[0] ? curiosityPriority(prioritizedStates[0]) : 0,
      prioritizedStates,
      experiments,
    };
  }
}

/**
 * Ranks a state for exploration. Information gain dominates (40%); novelty
 * and uncertainty contribute equally (25% each); the `1 / (1 + visitedCount)`
 * term gives a small but persistent bonus to states that have been
 * sampled less.
 */
export function curiosityPriority(state: CuriosityState): number {
  const unexplored = 1 / (1 + state.visitedCount);
  return clamp(
    state.expectedInformationGain * 0.4
      + state.novelty * 0.25
      + state.uncertainty * 0.25
      + unexplored * 0.1,
  );
}

/**
 * Wraps a state in an `ExperimentPlan`. The hypothesis text is templated
 * from the uncertainty value; future revisions can replace this with a
 * model-generated hypothesis once a simulator is wired in.
 */
export function planExperiment(state: CuriosityState): ExperimentPlan {
  const priority = curiosityPriority(state);
  return {
    experimentId: randomUUID(),
    stateId: state.stateId,
    hypothesis: `Exploring state ${state.stateId} will reduce uncertainty by ${state.uncertainty.toFixed(2)}.`,
    expectedInformationGain: state.expectedInformationGain,
    riskScore: clamp(state.uncertainty * 0.25),
    priority,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
