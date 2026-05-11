/**
 * World-model engine type surface.
 *
 * The world-model engine simulates the likely outcome of a candidate
 * action before the executor commits. Predictions are written to the
 * `world_model_predictions` index and emitted on the
 * `worldmodel.prediction` topic; once the actual outcome is observed,
 * the matching record is back-filled with the accuracy delta so the
 * reinforcement engine can score the prediction.
 */

import type { AgentContext, WorldModelPrediction, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";

/** Inputs to one simulation pass. */
export interface WorldModelSimulationInput {
  readonly currentStateSummary: string;
  readonly actionSummary: string;
  /** Optional agent context; richer context yields better confidence estimates. */
  readonly context?: AgentContext;
  /** Caller-supplied confidence prior, in `[0, 1]`. Defaults to 0.5. */
  readonly confidencePrior?: number;
}

/**
 * Output of a simulation, before the engine wraps it into a persisted
 * `WorldModelPrediction`. The optional `rationale` is a free-form tag
 * that downstream traces use to attribute the prediction to a specific
 * model variant.
 */
export interface SimulatedOutcome {
  readonly predictedOutcome: string;
  readonly riskScore: number;
  readonly confidence: number;
  readonly rationale?: string;
}

/**
 * Pluggable simulation strategy. The default implementation is
 * `HeuristicOutcomeSimulationModel`; an LLM-backed simulator can be
 * substituted by implementing this interface.
 */
export interface OutcomeSimulationModel {
  simulate(input: WorldModelSimulationInput): Promise<SimulatedOutcome>;
}

/** Persistence contract for prediction records. */
export interface WorldModelStore {
  savePrediction(prediction: WorldModelPrediction): Promise<void>;
  updatePrediction(update: WorldModelPredictionUpdate): Promise<void>;
}

/** Optional fan-out hook used to broadcast new predictions on Kafka. */
export interface WorldModelPredictionPublisher {
  publish(prediction: WorldModelPrediction): Promise<void>;
}
