/**
 * Confidence calibration and watchdog alerts.
 *
 * `CalibrationMonitor.evaluate` scores how well each operation's stated
 * confidence matched its observed outcome. The aggregate calibration
 * error feeds the reflection engine; the watchdog list flags when the
 * introspection pass itself has exceeded its own budget so that the
 * engine can be paused or scaled back.
 */

import type {
  CalibrationRecord,
  CalibrationReport,
  CognitiveOperationTrace,
  IntrospectionBudget,
} from "./types.js";

const DEFAULT_INTROSPECTION_BUDGET: IntrospectionBudget = {
  maxDepth: 2,
  maxOperations: 12,
  riskCeiling: 0.75,
};

export class CalibrationMonitor {
  private readonly budget: IntrospectionBudget;

  constructor(budget: Partial<IntrospectionBudget> = {}) {
    this.budget = { ...DEFAULT_INTROSPECTION_BUDGET, ...budget };
  }

  evaluate(
    traces: ReadonlyArray<CognitiveOperationTrace>,
    depth: number = 0,
  ): CalibrationReport {
    const bounded = traces.slice(0, this.budget.maxOperations);
    const records = bounded.map(toCalibrationRecord);
    const meanCalibrationError = mean(records.map((record) => record.calibrationError));

    return {
      records,
      meanCalibrationError,
      failureAttributions: bounded
        .filter((trace) => trace.succeeded === false)
        .map(attributeOperationFailure),
      watchdogAlerts: watchdogAlerts(bounded, this.budget, depth, meanCalibrationError),
    };
  }
}

/**
 * Discounts the raw operation confidence by risk (up to 25%) and by
 * latency (up to 20%, saturating at 60s). The discount captures the
 * intuition that high-risk or slow operations are less trustworthy
 * even when the agent reported high confidence.
 */
export function estimateOperationConfidence(trace: CognitiveOperationTrace): number {
  const riskPenalty = (trace.riskScore ?? 0) * 0.25;
  const latencyPenalty = Math.min(0.2, (trace.latencyMs ?? 0) / 60_000);
  return clamp(trace.confidence - riskPenalty - latencyPenalty);
}

function toCalibrationRecord(trace: CognitiveOperationTrace): CalibrationRecord {
  const confidence = estimateOperationConfidence(trace);
  const observedSuccess = trace.succeeded === undefined ? confidence : trace.succeeded ? 1 : 0;
  return {
    operationId: trace.operationId,
    operationType: trace.operationType,
    confidence,
    observedSuccess,
    calibrationError: Math.abs(confidence - observedSuccess),
  };
}

function attributeOperationFailure(trace: CognitiveOperationTrace): string {
  if ((trace.riskScore ?? 0) > 0.7) return `${trace.operationType}:risk_underestimated`;
  if ((trace.latencyMs ?? 0) > 30_000) return `${trace.operationType}:latency_budget_exceeded`;
  return `${trace.operationType}:outcome_mismatch`;
}

function watchdogAlerts(
  traces: ReadonlyArray<CognitiveOperationTrace>,
  budget: IntrospectionBudget,
  depth: number,
  meanCalibrationError: number,
): ReadonlyArray<string> {
  const alerts: string[] = [];
  if (depth > budget.maxDepth) alerts.push("introspection_depth_exceeded");
  if (traces.length > budget.maxOperations) alerts.push("introspection_operation_budget_exceeded");
  if (traces.some((trace) => (trace.riskScore ?? 0) > budget.riskCeiling)) {
    alerts.push("operation_risk_ceiling_exceeded");
  }
  if (meanCalibrationError > 0.35) alerts.push("calibration_drift_detected");
  return alerts;
}

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
