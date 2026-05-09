import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { ActiveInferenceProbe, GroundingResult, PredictionErrorFeedback, SensorReading } from "./types.js";

export class GroundingEngine {
  ground(readings: ReadonlyArray<SensorReading>): GroundingResult {
    const events = readings.map(toExperienceEvent);
    return {
      events,
      predictionFeedback: [],
      probes: proposeActiveInferenceProbes(readings),
    };
  }

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
