/**
 * World-model engine orchestrator.
 *
 * `WorldModelEngine.predict` calls the configured simulation model,
 * materialises the result as a `WorldModelPrediction`, optionally
 * persists it via a `WorldModelStore`, and optionally broadcasts it via
 * a `WorldModelPredictionPublisher`. `recordObservedOutcome` patches the
 * persisted record with the actual outcome reference so that the
 * reinforcement engine can later score prediction accuracy.
 *
 * Both the store and publisher are optional: the engine can be used
 * standalone in tests with no I/O dependencies.
 */

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
  /** Defaults to `HeuristicOutcomeSimulationModel`. */
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

  /**
   * Runs one simulation, persists the result if a store is configured,
   * and broadcasts it if a publisher is configured. The fully-formed
   * prediction is always returned.
   */
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

  /**
   * Back-fills the persisted record with the observed outcome reference
   * and accuracy. Silent no-op when no store is configured.
   */
  async recordObservedOutcome(update: WorldModelPredictionUpdate): Promise<void> {
    await this.store?.updatePrediction(update);
  }
}
