/**
 * API/BFF entry point.
 * Initialises telemetry, connects to Kafka, bootstraps OpenSearch, then
 * starts the Hono HTTP server.
 */

import { serve } from "@hono/node-server";
import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import { kafkaConfigFromEnv } from "@cognitive-substrate/kafka-bus";
import { startResponseConsumer } from "./kafka/response-consumer.js";
import { startExperienceProducer } from "./kafka/experience-producer.js";
import { startAuditConsumer } from "./kafka/audit-consumer.js";
import { createApp } from "./server.js";

const log = (msg: string): void => {
  process.stdout.write(`[api] ${new Date().toISOString()} ${msg}\n`);
};

async function main(): Promise<void> {
  const shutdownTelemetry = await initTelemetry(telemetryConfigFromEnv("api-bff"));

  const openSearchClient = createOpenSearchClient(opensearchConfigFromEnv());
  log("Ensuring OpenSearch indexes exist...");
  await ensureIndexes(openSearchClient);

  const kafkaConfig = kafkaConfigFromEnv();
  const stopProducer = await startExperienceProducer(kafkaConfig);
  const stopConsumer = await startResponseConsumer(kafkaConfig);
  const stopAuditConsumer = await startAuditConsumer(kafkaConfig, openSearchClient);
  log("Kafka producer and consumer connected.");

  const app = createApp(openSearchClient);
  const port = Number(process.env["PORT"] ?? process.env["API_PORT"] ?? "3001");

  const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
    log(`Listening on http://localhost:${port}`);
  });

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    server.close();
    await stopAuditConsumer();
    await stopConsumer();
    await stopProducer();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());
}

main().catch((err: unknown) => {
  process.stderr.write(`[api] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
