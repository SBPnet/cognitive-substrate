/**
 * Metacognition-engine type surface.
 *
 * The metacognition engine watches the cognitive loop's own decisions
 * and produces two complementary outputs:
 *
 *   1. `ReflectionResult` for one loop iteration: confidence calibration,
 *      failure attribution, and an optional `SelfModificationProposal`
 *      submitted to the constitution engine for approval.
 *   2. `CalibrationReport` over a batch of operation traces: per-trace
 *      records, mean calibration error, attributions for failures, and
 *      watchdog alerts when introspection itself runs over budget.
 */

import type { CognitiveLoopResult } from "@cognitive-substrate/agents";
import type { SelfModificationProposal } from "@cognitive-substrate/core-types";

/** Caps the rate at which the engine emits self-modification proposals. */
export interface ReflectionBudget {
  readonly maxReflectionsPerSession: number;
  /** Risk score above which the engine will not auto-propose a mutation. */
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

/** Optional fan-out hook used to broadcast proposals on Kafka. */
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

/**
 * Bounds on the introspection pass itself. The metacognition engine is
 * the system reasoning about its own reasoning; without a budget it
 * could recurse arbitrarily deep. Each value is checked by
 * `CalibrationMonitor.evaluate` and surfaced as a watchdog alert.
 */
export interface IntrospectionBudget {
  readonly maxDepth: number;
  readonly maxOperations: number;
  readonly riskCeiling: number;
}
