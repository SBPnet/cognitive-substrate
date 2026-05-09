import type { CuriosityState } from "@cognitive-substrate/curiosity-engine";
import type { ExperienceEvent, SemanticMemory } from "@cognitive-substrate/core-types";

export interface DreamScenario {
  readonly scenarioId: string;
  readonly sourceMemoryIds: ReadonlyArray<string>;
  readonly syntheticEvent: ExperienceEvent;
  readonly adversarialPressure: number;
  readonly stressScore: number;
}

export interface DreamInput {
  readonly memories: ReadonlyArray<SemanticMemory>;
  readonly curiosityStates?: ReadonlyArray<CuriosityState>;
  readonly maxScenarios?: number;
}

export interface DreamCycleResult {
  readonly scenarios: ReadonlyArray<DreamScenario>;
  readonly recombinedAbstractions: ReadonlyArray<string>;
  readonly stressFailures: ReadonlyArray<string>;
}
