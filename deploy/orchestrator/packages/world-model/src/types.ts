import type { AgentContext, WorldModelPrediction, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";

export interface WorldModelSimulationInput {
  readonly currentStateSummary: string;
  readonly actionSummary: string;
  readonly context?: AgentContext;
  readonly confidencePrior?: number;
}

export interface SimulatedOutcome {
  readonly predictedOutcome: string;
  readonly riskScore: number;
  readonly confidence: number;
  readonly rationale?: string;
}

export interface OutcomeSimulationModel {
  simulate(input: WorldModelSimulationInput): Promise<SimulatedOutcome>;
}

export interface WorldModelStore {
  savePrediction(prediction: WorldModelPrediction): Promise<void>;
  updatePrediction(update: WorldModelPredictionUpdate): Promise<void>;
}

export interface WorldModelPredictionPublisher {
  publish(prediction: WorldModelPrediction): Promise<void>;
}
