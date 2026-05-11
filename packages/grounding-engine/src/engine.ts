/**
 * Grounding engine.
 *
 * Converts sensor readings into experience events that the cognitive
 * pipeline can ingest, and proposes active-inference probes that would
 * reduce outstanding uncertainty. `computePredictionFeedback` is a
 * standalone helper that quantifies prediction error against a previous
 * world-model prediction.
 */

import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { ActiveInferenceProbe, GroundingResult, PredictionErrorFeedback, SensorReading } from "./types.js";

export class GroundingEngine {
  /**
   * Materialises sensor readings as experience events and proposes a
   * small batch of active-inference probes. Prediction feedback is left
   * empty because matching observations to previous predictions
   * requires external context; callers can compute it via
   * `computePredictionFeedback`.
   */
  ground(readings: ReadonlyArray<SensorReading>): GroundingResult {
    const events = readings.map(toExperienceEvent);
    return {
      events,
      predictionFeedback: [],
      probes: proposeActiveInferenceProbes(readings),
    };
  }

  /**
   * Quantifies prediction error. The accuracy field is `1 - error/scale`
   * where `scale` is the larger of 1 and the absolute expected value.
   * The `correction` payload is shaped for direct consumption by the
   * world-model store's `updatePrediction` method.
   */
  computePredictionFeedback(
    predictionId: string,
    observedValue: number,
    expectedValue: number,
    actualOutcomeReference: string,
  ): PredictionErrorFeedback {
    const error = Math.abs(observedValue - expectedValue);
    const scale = Math.max(1, Math.abs(expectedValue));
    return {
      predictionId,
      observedValue,
      expectedValue,
      error,
      correction: {
        predictionId,
        actualOutcomeReference,
        predictionAccuracy: clamp(1 - error / scale),
      },
    };
  }
}

/**
 * Converts one sensor reading into an experience event. The text body
 * is templated for human readability; structured fields preserve the
 * raw metric/value/unit for analysers downstream. Importance is a
 * coarse proxy `|value| / 100` clamped to `[0, 1]`.
 */
export function toExperienceEvent(reading: SensorReading): ExperienceEvent {
  return {
    eventId: randomUUID(),
    timestamp: reading.timestamp,
    type: "environmental_observation",
    context: {
      sessionId: `sensor:${reading.sensorId}`,
      traceId: randomUUID(),
    },
    input: {
      text: `${reading.metric} observed as ${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`,
      embedding: [],
      structured: {
        sensorId: reading.sensorId,
        metric: reading.metric,
        value: reading.value,
        ...(reading.unit ? { unit: reading.unit } : {}),
      },
    },
    importanceScore: clamp(Math.abs(reading.value) / 100),
    tags: reading.tags ?? ["grounded-observation"],
  };
}

/**
 * Proposes up to five probes targeting metrics with a non-zero current
 * reading. Information-gain and risk are both scaled by the magnitude
 * of the observed value so that strongly anomalous metrics surface as
 * higher-priority probes.
 */
export function proposeActiveInferenceProbes(
  readings: ReadonlyArray<SensorReading>,
): ReadonlyArray<ActiveInferenceProbe> {
  return readings
    .filter((reading) => Math.abs(reading.value) > 0)
    .slice(0, 5)
    .map((reading) => ({
      probeId: randomUUID(),
      question: `Probe whether ${reading.metric} changes after intervention.`,
      targetMetric: reading.metric,
      expectedInformationGain: clamp(Math.abs(reading.value) / 100),
      riskScore: clamp(Math.abs(reading.value) / 500),
    }));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
