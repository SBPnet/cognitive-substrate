/**
 * World-model prediction records.
 *
 * The world-model engine simulates the likely outcome of a candidate action
 * before the executor commits to it. Predictions are written to the
 * `world_model_predictions` index and later joined with the observed
 * outcome so that prediction accuracy can be tracked over time and used
 * by the reinforcement engine to update arbitration weights.
 */

/** A single forward simulation produced by the world-model engine. */
export interface WorldModelPrediction {
  readonly predictionId: string;
  readonly timestamp: string;
  /** Compressed description of the state used as the simulation input. */
  readonly currentStateSummary: string;
  /** Compressed description of the candidate action. */
  readonly actionSummary: string;
  /** Predicted outcome text. */
  readonly predictedOutcome: string;
  /** Estimated risk of the action, in `[0, 1]`. */
  readonly riskScore: number;
  /** Confidence in the prediction, in `[0, 1]`. */
  readonly confidence: number;
  /** Reference to the actual outcome, populated retrospectively. */
  readonly actualOutcomeReference?: string;
  /** Accuracy of the prediction relative to observed outcome, in `[0, 1]`. */
  readonly predictionAccuracy?: number;
}

/**
 * Retrospective update applied once the actual outcome of a predicted
 * action is observed. Used to backfill `actualOutcomeReference` and
 * `predictionAccuracy` on the original prediction record.
 */
export interface WorldModelPredictionUpdate {
  readonly predictionId: string;
  readonly actualOutcomeReference: string;
  readonly predictionAccuracy: number;
}
