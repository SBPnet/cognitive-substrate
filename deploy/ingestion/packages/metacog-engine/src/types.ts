import type { CognitiveLoopResult } from "@cognitive-substrate/agents";
import type { SelfModificationProposal } from "@cognitive-substrate/core-types";

export interface ReflectionBudget {
  readonly maxReflectionsPerSession: number;
  readonly maxRiskForAutomaticProposal: number;
}

export interface ReflectionInput {
  readonly loopResult: CognitiveLoopResult;
  readonly priorReflectionsInSession?: number;
}

export interface ReflectionResult {
  readonly confidence: number;
  readonly calibrationError: number;
  readonly failureAttribution: string;
  readonly strategyReflection: string;
  readonly budgetAllowed: boolean;
  readonly proposal?: SelfModificationProposal;
}

export interface SelfModificationPublisher {
  publish(proposal: SelfModificationProposal): Promise<void>;
}

export interface CognitiveOperationTrace {
  readonly operationId: string;
  readonly operationType: string;
  readonly confidence: number;
  readonly succeeded?: boolean;
  readonly riskScore?: number;
  readonly latencyMs?: number;
}

export interface CalibrationRecord {
  readonly operationId: string;
  readonly operationType: string;
  readonly confidence: number;
  readonly observedSuccess: number;
  readonly calibrationError: number;
}

export interface CalibrationReport {
  readonly records: ReadonlyArray<CalibrationRecord>;
  readonly meanCalibrationError: number;
  readonly failureAttributions: ReadonlyArray<string>;
  readonly watchdogAlerts: ReadonlyArray<string>;
}

export interface IntrospectionBudget {
  readonly maxDepth: number;
  readonly maxOperations: number;
  readonly riskCeiling: number;
}
