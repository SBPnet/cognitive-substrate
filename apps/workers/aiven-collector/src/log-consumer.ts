/**
 * Kafka log consumer for Aiven kafka_logs integration.
 *
 * Aiven pushes each service's log stream into a Kafka topic named
 * "aiven.logs.<service-name>" via the kafka_logs service integration.
 * This module subscribes to all such topics (discovered by prefix) and
 * re-publishes each entry as a RawLogMessage to TELEMETRY_LOGS_RAW,
 * matching the shape the rest of the telemetry pipeline expects.
 *
 * Topic discovery: the worker subscribes using a regex so newly added
 * services are picked up without a restart (KafkaJS regex subscription).
 */

import {
  Topics,
  CognitiveConsumer,
  type CognitiveProducer,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import type { RawLogMessage } from "./messages.js";

export interface LogConsumerConfig {
  readonly kafkaClientId: string;
  readonly kafkaGroupId: string;
  readonly logsTopicPrefix: string;
  readonly environment: string;
}

interface AivenKafkaLogEntry {
  readonly message?: string;
  readonly msg?: string;
  readonly timestamp?: string;
  readonly time?: string;
  readonly hostname?: string;
  readonly unit?: string;
  readonly service?: string;
  readonly [key: string]: unknown;
}

export async function startLogConsumer(
  config: LogConsumerConfig,
  producer: CognitiveProducer,
  log: (message: string) => void,
): Promise<() => Promise<void>> {
  const kafkaConfig = kafkaConfigFromEnv();
  const kafka = createKafkaClient({ ...kafkaConfig, clientId: `${config.kafkaClientId}-log-consumer` });

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: config.kafkaGroupId,
  });

  await consumer.connect();

  // KafkaJS supports regex topic subscription; this picks up all
  // aiven.logs.* topics including ones added after the consumer starts.
  await consumer.subscribeRegex<AivenKafkaLogEntry>(
    new RegExp(`^${escapeRegex(config.logsTopicPrefix)}\\.`),
    async (message) => {
      const topic: string = message.topic;
      const serviceId = topicToServiceId(topic, config.logsTopicPrefix);
      const entry = message.value;

      const raw: RawLogMessage = {
        project: config.environment,
        serviceId,
        serviceType: entry["service"] ?? "unknown",
        message: entry.message ?? entry.msg ?? JSON.stringify(entry),
        timestamp: entry.timestamp ?? entry.time ?? new Date().toISOString(),
        observedAt: new Date().toISOString(),
        environment: config.environment,
        ...(entry.unit ? { unit: entry.unit } : {}),
      };

      await producer.publish(Topics.TELEMETRY_LOGS_RAW, raw, { key: serviceId });
    },
  );

  log(`Log consumer subscribed to topics matching: ${config.logsTopicPrefix}.*`);

  return () => consumer.disconnect();
}

function topicToServiceId(topic: string, prefix: string): string {
  const withDot = `${prefix}.`;
  return topic.startsWith(withDot) ? topic.slice(withDot.length) : topic;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
