/**
 * Development-engine type surface.
 *
 * The development engine staggers feature unlocks. Subsystems become
 * available as the system's capability scores rise through a sequence
 * of phases. This is computational, not biological: phase progression
 * is a function of measured capability scores, not of training time.
 *
 *   seed       : ingestion + retrieval only
 *   novice     : adds consolidation + policy
 *   apprentice : adds agents + world-model + goals
 *   integrative: adds attention + affect + metacognition
 *   open_ended : adds constitution + development + open-ended search
 */

/** Progression label assigned to the system's current capability level. */
export type DevelopmentPhase = "seed" | "novice" | "apprentice" | "integrative" | "open_ended";

export interface CapabilityMetric {
  readonly capabilityId: string;
  readonly score: number;
  readonly evidenceCount: number;
}

export interface CurriculumItem {
  readonly itemId: string;
  readonly capabilityId: string;
  readonly difficulty: number;
  readonly expectedGain: number;
}

export interface DevelopmentState {
  readonly phase: DevelopmentPhase;
  readonly unlockedSubsystems: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<CapabilityMetric>;
}

export interface DevelopmentAssessment {
  readonly state: DevelopmentState;
  readonly selectedCurriculum: ReadonlyArray<CurriculumItem>;
  readonly phaseTransitionDetected: boolean;
}
