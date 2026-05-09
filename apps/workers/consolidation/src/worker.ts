import {
  ConsolidationEngine,
  type ConsolidationRequest,
} from "@cognitive-substrate/consolidation-engine";
import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("consolidation-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[consolidation-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafka = createKafkaClient(kafkaConfigFromEnv());
  const openSearchClient = createOpenSearchClient(opensearchConfigFromEnv());
  const engine = new ConsolidationEngine({ openSearch: openSearchClient });

  log("Ensuring OpenSearch indexes exist...");
  await ensureIndexes(openSearchClient);

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: true });
  await producer.connect();

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "consolidation-workers",
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.CONSOLIDATION_REQUEST}...`);

  await consumer.subscribe<ConsolidationRequest>(
    [Topics.CONSOLIDATION_REQUEST],
    async (message) => {
      const request = message.value;
      log(`Processing consolidation request ${request.requestId}`);

      let result;
      try {
        result = await engine.consolidate(request);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("at least one replay candidate")) {
          log(`Skipping consolidation request ${request.requestId}: no replay candidates available yet`);
          return;
        }
        throw error;
      }

      await producer.publish(Topics.MEMORY_SEMANTIC_UPDATED, result, {
        key: result.semanticMemory.memoryId,
      });

      log(
        `Published semantic memory ${result.semanticMemory.memoryId} from ${result.sourceEventIds.length} sources`,
      );
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await consumer.disconnect();
    await producer.disconnect();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Waiting for consolidation requests...");
}
