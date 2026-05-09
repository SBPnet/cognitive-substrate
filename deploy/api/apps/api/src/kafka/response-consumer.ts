/**
 * Shared Kafka consumer for the `interaction.response` topic.
 * Routes each event to the appropriate session subscriber via SessionEventBus.
 */

import type { InteractionResponseEvent } from "@cognitive-substrate/core-types";
import {
  CognitiveConsumer,
  Topics,
  type KafkaClientConfig,
  createKafkaClient,
} from "@cognitive-substrate/kafka-bus";
import { sessionEventBus } from "./session-bus.js";

let consumer: CognitiveConsumer | null = null;

export async function startResponseConsumer(
  kafkaConfig: KafkaClientConfig,
): Promise<() => Promise<void>> {
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: `${kafkaConfig.clientId}-response-consumer`,
  });

  consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "api-bff-consumers",
  });

  await consumer.connect();

  await consumer.subscribe<InteractionResponseEvent>(
    [Topics.INTERACTION_RESPONSE],
    async (message) => {
      const event = message.value;
      sessionEventBus.emit(event.sessionId, event);
    },
  );

  return async () => {
    if (consumer) {
      await consumer.disconnect();
      consumer = null;
    }
  };
}
