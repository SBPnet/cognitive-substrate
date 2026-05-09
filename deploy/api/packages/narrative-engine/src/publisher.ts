import type { IdentityUpdateEvent } from "@cognitive-substrate/core-types";
import { Topics, type CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { IdentityUpdatePublisher } from "./types.js";

export class KafkaIdentityUpdatePublisher implements IdentityUpdatePublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(event: IdentityUpdateEvent): Promise<void> {
    await this.producer.publish(Topics.IDENTITY_UPDATED, event, {
      key: event.identityId,
    });
  }
}
