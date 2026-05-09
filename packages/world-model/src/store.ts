import type { WorldModelPrediction, WorldModelPredictionUpdate } from "@cognitive-substrate/core-types";
import type { Client } from "@opensearch-project/opensearch";
import { indexDocument, updateDocument } from "@cognitive-substrate/memory-opensearch";
import type { WorldModelStore } from "./types.js";

export interface WorldModelPredictionRecord extends Record<string, unknown> {
  readonly prediction_id: string;
  readonly timestamp: string;
  readonly current_state_summary: string;
  readonly action_summary: string;
  readonly predicted_outcome: string;
  readonly risk_score: number;
  readonly confidence: number;
  readonly actual_outcome_reference?: string;
  readonly prediction_accuracy?: number;
}

export class OpenSearchWorldModelStore implements WorldModelStore {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async savePrediction(prediction: WorldModelPrediction): Promise<void> {
    await indexDocument(
      this.client,
      "world_model_predictions",
      prediction.predictionId,
      toRecord(prediction),
    );
  }

  async updatePrediction(update: WorldModelPredictionUpdate): Promise<void> {
    await updateDocument(this.client, "world_model_predictions", update.predictionId, {
      actual_outcome_reference: update.actualOutcomeReference,
      prediction_accuracy: update.predictionAccuracy,
    });
  }
}

export function toRecord(prediction: WorldModelPrediction): WorldModelPredictionRecord {
  return {
    prediction_id: prediction.predictionId,
    timestamp: prediction.timestamp,
    current_state_summary: prediction.currentStateSummary,
    action_summary: prediction.actionSummary,
    predicted_outcome: prediction.predictedOutcome,
    risk_score: prediction.riskScore,
    confidence: prediction.confidence,
    ...(prediction.actualOutcomeReference
      ? { actual_outcome_reference: prediction.actualOutcomeReference }
      : {}),
    ...(prediction.predictionAccuracy !== undefined
      ? { prediction_accuracy: prediction.predictionAccuracy }
      : {}),
  };
}
