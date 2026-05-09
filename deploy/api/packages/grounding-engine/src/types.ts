import type { ExperienceEvent, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";

export interface SensorReading {
  readonly sensorId: string;
  readonly timestamp: string;
  readonly metric: string;
  readonly value: number;
  readonly unit?: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface PredictionErrorFeedback {
  readonly predictionId: string;
  readonly observedValue: number;
  readonly expectedValue: number;
  readonly error: number;
  readonly correction: WorldModelPredictionUpdate;
}

export interface ActiveInferenceProbe {
  readonly probeId: string;
  readonly question: string;
  readonly targetMetric: string;
  readonly expectedInformationGain: number;
  readonly riskScore: number;
}

export interface GroundingResult {
  readonly events: ReadonlyArray<ExperienceEvent>;
  readonly predictionFeedback: ReadonlyArray<PredictionErrorFeedback>;
  readonly probes: ReadonlyArray<ActiveInferenceProbe>;
}
