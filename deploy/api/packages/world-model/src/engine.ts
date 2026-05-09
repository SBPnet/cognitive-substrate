import { randomUUID } from "node:crypto";
import type { WorldModelPrediction, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";
import { HeuristicOutcomeSimulationModel } from "./model.js";
import type {
  OutcomeSimulationModel,
  WorldModelPredictionPublisher,
  WorldModelSimulationInput,
  WorldModelStore,
} from "./types.js";

export interface WorldModelEngineConfig {
  readonly model?: OutcomeSimulationModel;
  readonly store?: WorldModelStore;
  readonly publisher?: WorldModelPredictionPublisher;
}

export class WorldModelEngine {
  private readonly model: OutcomeSimulationModel;
  private readonly store: WorldModelStore | undefined;
  private readonly publisher: WorldModelPredictionPublisher | undefined;

  constructor(config: WorldModelEngineConfig = {}) {
    this.model = config.model ?? new HeuristicOutcomeSimulationModel();
    this.store = config.store;
    this.publisher = config.publisher;
  }

  async predict(input: WorldModelSimulationInput): Promise<WorldModelPrediction> {
    const simulated = await this.model.simulate(input);
    const prediction: WorldModelPrediction = {
      predictionId: randomUUID(),
      timestamp: new Date().toISOString(),
      currentStateSummary: input.currentStateSummary,
      actionSummary: input.actionSummary,
      predictedOutcome: simulated.predictedOutcome,
      riskScore: simulated.riskScore,
      confidence: simulated.confidence,
    };

    await this.store?.savePrediction(prediction);
    await this.publisher?.publish(prediction);
    return prediction;
  }

  async recordObservedOutcome(update: WorldModelPredictionUpdate): Promise<void> {
    await this.store?.updatePrediction(update);
  }
}
