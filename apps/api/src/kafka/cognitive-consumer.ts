/**
 * Multi-topic Kafka consumer that forwards cognitive pipeline events to
 * browser clients via the KafkaEventBus.
 *
 * Each message is keyed by sessionId. Topics covered:
 *   experience.raw, experience.enriched, memory.indexed,
 *   agent.reasoning.request, agent.reasoning.response,
 *   policy.updated, goal.progress
 */

import {
  CognitiveConsumer,
  Topics,
  type KafkaClientConfig,
  createKafkaClient,
} from "@cognitive-substrate/kafka-bus";
import { kafkaEventBus } from "./kafka-event-bus.js";
import type { KafkaEventDto } from "../types.js";

const COGNITIVE_TOPICS = [
  Topics.EXPERIENCE_RAW,
  Topics.EXPERIENCE_ENRICHED,
  Topics.MEMORY_INDEXED,
  Topics.AGENT_REASONING_REQUEST,
  Topics.AGENT_REASONING_RESPONSE,
  Topics.POLICY_UPDATED,
  Topics.GOAL_PROGRESS,
] as const;

let consumer: CognitiveConsumer | null = null;

export async function startCognitiveConsumer(
  kafkaConfig: KafkaClientConfig,
): Promise<() => Promise<void>> {
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: `${kafkaConfig.clientId}-cognitive-consumer`,
  });

  consumer = new CognitiveConsumer({
    kafka,
    groupId: `${process.env["KAFKA_GROUP_ID"] ?? "api-bff-consumers"}-cognitive`,
  });

  await consumer.connect();

  for (const topic of COGNITIVE_TOPICS) {
    await consumer.subscribe<Record<string, unknown>>(
      [topic],
      async (message) => {
        const payload = message.value;
        // Extract sessionId from known field locations across event shapes
        const sessionId =
          (payload as { sessionId?: string }).sessionId ??
          (payload as { context?: { sessionId?: string } }).context?.sessionId ??
          (payload as { session_id?: string }).session_id;

        if (!sessionId || !kafkaEventBus.hasSubscribers(sessionId)) return;

        const event: KafkaEventDto = {
          topic,
          key: sessionId,
          timestamp: new Date().toISOString(),
          payload,
        };
        kafkaEventBus.emit(sessionId, event);
      },
    );
  }

  return async () => {
    if (consumer) {
      await consumer.disconnect();
      consumer = null;
    }
  };
}
