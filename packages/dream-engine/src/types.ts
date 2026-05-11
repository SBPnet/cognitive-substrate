/**
 * Dream-engine type surface.
 *
 * The dream engine runs an offline "what-if" cycle that recombines
 * pairs of consolidated semantic memories into adversarial synthetic
 * scenarios. Each scenario produces a synthetic ExperienceEvent that
 * downstream workers can replay to stress-test the policy and identity
 * layers without exposing the system to live traffic. Scenarios with a
 * stress score above 0.7 are surfaced separately as `stressFailures`
 * for offline review.
 */

import type { CuriosityState } from "@cognitive-substrate/curiosity-engine";
import type { ExperienceEvent, SemanticMemory } from "@cognitive-substrate/core-types";

/** One synthesised what-if scenario produced by the engine. */
export interface DreamScenario {
  readonly scenarioId: string;
  readonly sourceMemoryIds: ReadonlyArray<string>;
  /** Synthetic event with `type: "system_event"` so it does not pollute episodic stats. */
  readonly syntheticEvent: ExperienceEvent;
  /** Combined contradiction pressure of the source memories, in `[0, 1]`. */
  readonly adversarialPressure: number;
  /** Aggregate stress score; values above 0.7 are flagged as failures. */
  readonly stressScore: number;
}

/** Inputs to one dream cycle. */
export interface DreamInput {
  readonly memories: ReadonlyArray<SemanticMemory>;
  /** Optional curiosity states; reserved for future scenario weighting. */
  readonly curiosityStates?: ReadonlyArray<CuriosityState>;
  /** Maximum number of scenarios to synthesise; defaults to 5. */
  readonly maxScenarios?: number;
}

/** Aggregate output of one dream cycle. */
export interface DreamCycleResult {
  readonly scenarios: ReadonlyArray<DreamScenario>;
  /** Free-text recombinations of paired generalisations for offline study. */
  readonly recombinedAbstractions: ReadonlyArray<string>;
  /** IDs of scenarios whose stress score exceeded the failure threshold. */
  readonly stressFailures: ReadonlyArray<string>;
}
