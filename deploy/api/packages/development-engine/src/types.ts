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
