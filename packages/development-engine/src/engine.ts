/**
 * Development planner.
 *
 * `DevelopmentEngine.assess` infers the current phase from the mean
 * capability score, unlocks any subsystems that the new phase exposes,
 * and selects the next curriculum slice. `selectCurriculum` ranks items
 * by expected gain and a "readiness" term that prefers items whose
 * difficulty is close to the current capability score, avoiding both
 * under-stretch and over-reach.
 */

import type {
  CapabilityMetric,
  CurriculumItem,
  DevelopmentAssessment,
  DevelopmentPhase,
  DevelopmentState,
} from "./types.js";

/** Canonical phase ordering used for monotonic subsystem unlocks. */
const PHASES: ReadonlyArray<DevelopmentPhase> = ["seed", "novice", "apprentice", "integrative", "open_ended"];

export class DevelopmentEngine {
  assess(
    current: DevelopmentState,
    curriculum: ReadonlyArray<CurriculumItem>,
  ): DevelopmentAssessment {
    const phase = inferPhase(current.capabilities);
    const phaseTransitionDetected = phase !== current.phase;
    const state: DevelopmentState = {
      phase,
      unlockedSubsystems: unlockSubsystems(phase, current.unlockedSubsystems),
      capabilities: current.capabilities,
    };

    return {
      state,
      selectedCurriculum: selectCurriculum(curriculum, current.capabilities),
      phaseTransitionDetected,
    };
  }
}

/** Maps mean capability score to a phase via fixed thresholds. */
export function inferPhase(capabilities: ReadonlyArray<CapabilityMetric>): DevelopmentPhase {
  const meanScore = mean(capabilities.map((capability) => capability.score));
  if (meanScore >= 0.85) return "open_ended";
  if (meanScore >= 0.68) return "integrative";
  if (meanScore >= 0.48) return "apprentice";
  if (meanScore >= 0.25) return "novice";
  return "seed";
}

export function selectCurriculum(
  curriculum: ReadonlyArray<CurriculumItem>,
  capabilities: ReadonlyArray<CapabilityMetric>,
): ReadonlyArray<CurriculumItem> {
  return [...curriculum]
    .sort((left, right) => curriculumPriority(right, capabilities) - curriculumPriority(left, capabilities))
    .slice(0, 5);
}

function curriculumPriority(
  item: CurriculumItem,
  capabilities: ReadonlyArray<CapabilityMetric>,
): number {
  const current = capabilities.find((capability) => capability.capabilityId === item.capabilityId)?.score ?? 0;
  const readiness = 1 - Math.abs(item.difficulty - current);
  return item.expectedGain * 0.6 + readiness * 0.4;
}

function unlockSubsystems(
  phase: DevelopmentPhase,
  existing: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const required = {
    seed: ["ingestion", "retrieval"],
    novice: ["consolidation", "policy"],
    apprentice: ["agents", "world-model", "goals"],
    integrative: ["attention", "affect", "metacognition"],
    open_ended: ["constitution", "development", "open-ended-search"],
  } satisfies Record<DevelopmentPhase, ReadonlyArray<string>>;

  const phaseIndex = PHASES.indexOf(phase);
  const unlocked = PHASES.slice(0, phaseIndex + 1).flatMap((item) => required[item]);
  return [...new Set([...existing, ...unlocked])];
}

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
