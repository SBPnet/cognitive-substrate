import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createTelemetryClientFromEnv,
} from "@cognitive-substrate/clickhouse-telemetry";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import { processTelemetryBatch, type RawMetricMessage } from "./pipeline.js";

const BATCH_WINDOW_MS = 5_000;
const BATCH_MAX_SIZE = 500;

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("telemetry-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[telemetry-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafka = createKafkaClient(kafkaConfigFromEnv());
  const clickhouse = createTelemetryClientFromEnv();

  log("Ensuring ClickHouse tables exist...");
  await clickhouse.ensureTables();

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "telemetry-workers",
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.TELEMETRY_METRICS_RAW}...`);

  // Accumulate messages into batches before processing to amortise ClickHouse
  // insert overhead.  Batches are flushed either when they reach BATCH_MAX_SIZE
  // or after BATCH_WINDOW_MS milliseconds, whichever comes first.
  let batch: RawMetricMessage[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    log(`Flushing batch of ${current.length} metric messages`);
    await processTelemetryBatch(current, { producer, clickhouse });
  };

  const scheduleFlush = (): void => {
    if (!flushTimer) {
      flushTimer = setTimeout(() => void flush(), BATCH_WINDOW_MS);
    }
  };

  await consumer.subscribe<RawMetricMessage>(
    [Topics.TELEMETRY_METRICS_RAW],
    async (message) => {
      batch.push(message.value);
      if (batch.length >= BATCH_MAX_SIZE) {
        await flush();
      } else {
        scheduleFlush();
      }
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await flush();
    await consumer.disconnect();
    await producer.disconnect();
    await clickhouse.close();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Waiting for messages...");
}
