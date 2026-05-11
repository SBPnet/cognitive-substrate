/**
 * Kafka adapter for world-model predictions.
 *
 * Publishes each prediction onto the `worldmodel.prediction` topic using
 * the prediction ID as the partition key, which keeps all updates for a
 * single prediction (the initial save and any future revisions) on the
 * same partition for in-order consumption by downstream workers.
 */

import type { WorldModelPrediction } from "@cognitive-substrate/core-types";
import { Topics, type CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { WorldModelPredictionPublisher } from "./types.js";

export class KafkaWorldModelPredictionPublisher implements WorldModelPredictionPublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(prediction: WorldModelPrediction): Promise<void> {
    await this.producer.publish(Topics.WORLDMODEL_PREDICTION, prediction, {
      key: prediction.predictionId,
    });
  }
}
