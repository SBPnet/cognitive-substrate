/**
 * Ingest worker — consumes blog TelemetryEvents from Kafka and writes them
 * to OpenSearch as ExperienceEvents.
 *
 * Pipeline:
 *   blog VPS → KafkaTransport → telemetry.logs.raw → [this worker]
 *            → mapTelemetryToExperience → ExperienceWriter → experience_events
 *
 * The experience_events index must have a neural ingest pipeline configured
 * as its default_pipeline so embeddings are generated at index time.
 * Run provision-indexes from @cognitive-substrate/memory-opensearch first.
 *
 * Environment variables:
 *   KAFKA_BROKERS        — required, e.g. "thor:9092"
 *   KAFKA_CLIENT_ID      — optional, defaults to "ingest-worker"
 *   KAFKA_GROUP_ID       — optional, defaults to "ingest-worker-group"
 *   OPENSEARCH_URL       — required, e.g. "http://thor:9200"
 *   WRITER_BUFFER_SIZE   — optional, documents before flush (default 50)
 *   WRITER_FLUSH_MS      — optional, max ms between flushes (default 5000)
 */

import {
  createKafkaClient,
  kafkaConfigFromEnv,
  ensureKafkaTopics,
  CognitiveConsumer,
  Topics,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { mapTelemetryToExperience, type TelemetryEvent } from "./mapper.js";
import { ExperienceWriter } from "./writer.js";

async function main(): Promise<void> {
  const kafkaConfig = kafkaConfigFromEnv();
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: process.env["KAFKA_CLIENT_ID"] ?? "ingest-worker",
  });

  console.log("[ingest-worker] Ensuring Kafka topics exist...");
  await ensureKafkaTopics(kafkaConfig, [Topics.TELEMETRY_LOGS_RAW]);
  console.log("[ingest-worker] Topics ready.");

  const osClient = createOpenSearchClient(opensearchConfigFromEnv());
  const writer = new ExperienceWriter({
    client: osClient,
    bufferSize: Number(process.env["WRITER_BUFFER_SIZE"] ?? "50"),
    flushIntervalMs: Number(process.env["WRITER_FLUSH_MS"] ?? "5000"),
  });

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "ingest-worker-group",
  });

  await consumer.connect();
  console.log(
    `[ingest-worker] Connected. Consuming ${Topics.TELEMETRY_LOGS_RAW} → experience_events`,
  );

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ingest-worker] ${signal} received, shutting down...`);
    await consumer.disconnect();
    await writer.close();
    console.log("[ingest-worker] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT",  () => { void shutdown("SIGINT"); });

  await consumer.subscribe<TelemetryEvent>(
    [Topics.TELEMETRY_LOGS_RAW],
    async (message) => {
      const event = message.value;

      if (!event?.type || !event?.sessionId) {
        console.warn("[ingest-worker] Skipping malformed message at offset", message.offset);
        return;
      }

      const experience = mapTelemetryToExperience(event);
      await writer.write(experience);
    },
  );
}

main().catch((err) => {
  console.error("[ingest-worker] Fatal:", (err as Error).message);
  process.exit(1);
});
