/** World-model prediction records used by simulation and arbitration. */

export interface WorldModelPrediction {
  readonly predictionId: string;
  readonly timestamp: string;
  readonly currentStateSummary: string;
  readonly actionSummary: string;
  readonly predictedOutcome: string;
  readonly riskScore: number;
  readonly confidence: number;
  readonly actualOutcomeReference?: string;
  readonly predictionAccuracy?: number;
}

export interface WorldModelPredictionUpdate {
  readonly predictionId: string;
  readonly actualOutcomeReference: string;
  readonly predictionAccuracy: number;
}
