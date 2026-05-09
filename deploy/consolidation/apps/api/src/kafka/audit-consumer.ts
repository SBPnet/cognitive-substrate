/**
 * Kafka consumer that materializes mirrored audit events into OpenSearch.
 */

import { randomUUID } from "node:crypto";
import {
  CognitiveConsumer,
  Topics,
  type KafkaClientConfig,
  createKafkaClient,
} from "@cognitive-substrate/kafka-bus";
import { indexDocument, type CognitiveIndex } from "@cognitive-substrate/memory-opensearch";
import type { Client } from "@opensearch-project/opensearch";

interface AuditEvent extends Record<string, unknown> {
  readonly originalTopic?: string;
  readonly payload?: Record<string, unknown>;
  readonly timestamp?: string;
}

let consumer: CognitiveConsumer | null = null;

export async function startAuditConsumer(
  kafkaConfig: KafkaClientConfig,
  openSearchClient: Client,
): Promise<() => Promise<void>> {
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: `${kafkaConfig.clientId}-audit-consumer`,
  });

  consumer = new CognitiveConsumer({
    kafka,
    groupId: `${process.env["KAFKA_GROUP_ID"] ?? "api-bff-consumers"}-audit`,
  });

  await consumer.connect();

  await consumer.subscribe<AuditEvent>(
    [Topics.AUDIT_EVENTS],
    async (message) => {
      const event = message.value;
      const timestamp = event.timestamp ?? new Date().toISOString();
      const auditId = `${timestamp}-${message.key ?? randomUUID()}`;
      await indexDocument(
        openSearchClient,
        "audit_events" as CognitiveIndex,
        auditId,
        {
          audit_id: auditId,
          timestamp,
          originalTopic: event.originalTopic ?? "unknown",
          payload: event.payload ?? {},
        },
      );
    },
  );

  return async () => {
    if (consumer) {
      await consumer.disconnect();
      consumer = null;
    }
  };
}
