/**
 * Grounding-engine type surface.
 *
 * The grounding engine bridges environmental sensor data into the
 * cognitive pipeline. Sensor readings are converted into experience
 * events (`environmental_observation` type), prediction-error feedback
 * is produced when an observed value can be compared with a previous
 * world-model prediction, and active-inference probes nominate
 * additional measurements that would best reduce uncertainty.
 */

import type { ExperienceEvent, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";

/** A single observation produced by an environmental sensor. */
export interface SensorReading {
  readonly sensorId: string;
  readonly timestamp: string;
  readonly metric: string;
  readonly value: number;
  readonly unit?: string;
  readonly tags?: ReadonlyArray<string>;
}

/**
 * Comparison between an observed value and a previous prediction.
 * Includes a `correction` payload that is shaped to match the
 * world-model store's `updatePrediction` interface so callers can
 * forward it directly.
 */
export interface PredictionErrorFeedback {
  readonly predictionId: string;
  readonly observedValue: number;
  readonly expectedValue: number;
  readonly error: number;
  readonly correction: WorldModelPredictionUpdate;
}

/** A proposed measurement that would resolve outstanding uncertainty. */
export interface ActiveInferenceProbe {
  readonly probeId: string;
  readonly question: string;
  readonly targetMetric: string;
  readonly expectedInformationGain: number;
  readonly riskScore: number;
}

/** Aggregate output of one grounding pass. */
export interface GroundingResult {
  readonly events: ReadonlyArray<ExperienceEvent>;
  readonly predictionFeedback: ReadonlyArray<PredictionErrorFeedback>;
  readonly probes: ReadonlyArray<ActiveInferenceProbe>;
}
