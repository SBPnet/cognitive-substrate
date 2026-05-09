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
