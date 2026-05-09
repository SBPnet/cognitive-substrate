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

export function curiosityPriority(state: CuriosityState): number {
  const unexplored = 1 / (1 + state.visitedCount);
  return clamp(
    state.expectedInformationGain * 0.4
      + state.novelty * 0.25
      + state.uncertainty * 0.25
      + unexplored * 0.1,
  );
}

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
