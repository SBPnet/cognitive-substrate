import type { GoalProgressEvent } from "@cognitive-substrate/core-types";
import { Topics, type CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { GoalProgressPublisher } from "./goal-system.js";

export class KafkaGoalProgressPublisher implements GoalProgressPublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(event: GoalProgressEvent): Promise<void> {
    await this.producer.publish(Topics.GOAL_PROGRESS, event, {
      key: event.goalId,
    });
  }
}
