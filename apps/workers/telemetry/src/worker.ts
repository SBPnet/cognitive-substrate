import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createTelemetryClientFromEnv,
  TelemetryInserter,
  type LogsRawRow,
} from "@cognitive-substrate/clickhouse-telemetry";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import {
  telemetryExperienceBridgeFromEnv,
  type RawLogMessage,
  type RawMetadataMessage,
} from "./experience-bridge.js";
import { processTelemetryBatch, type RawMetricMessage } from "./pipeline.js";

const BATCH_WINDOW_MS = 5_000;
const BATCH_MAX_SIZE = 500;

type TelemetryWorkerMessage =
  | RawMetricMessage
  | RawLogMessage
  | RawMetadataMessage;

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

  // High-volume metric tier: audit mirroring would re-publish every raw metric
  // message onto the audit topic, doubling bus throughput for no diagnostic gain.
  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();
  const experienceBridge = telemetryExperienceBridgeFromEnv(producer);
  const inserter = new TelemetryInserter(clickhouse);

  const kafkaGroupId = process.env["KAFKA_GROUP_ID"] ?? "telemetry-workers";
  const consumer = new CognitiveConsumer({
    kafka,
    groupId: kafkaGroupId,
  });
  await consumer.connect();

  log(
    `Subscribing to ${[
      Topics.TELEMETRY_METRICS_RAW,
      Topics.TELEMETRY_LOGS_RAW,
      Topics.TELEMETRY_METADATA_RAW,
    ].join(", ")}...`,
  );

  // Accumulate messages into batches before processing to amortise ClickHouse
  // insert overhead.  Batches are flushed either when they reach BATCH_MAX_SIZE
  // or after BATCH_WINDOW_MS milliseconds, whichever comes first.
  let batch: RawMetricMessage[] = [];
  let logBatch: RawLogMessage[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = async (): Promise<void> => {
    if (batch.length === 0 && logBatch.length === 0) return;
    const currentMetrics = batch;
    const currentLogs = logBatch;
    batch = [];
    logBatch = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (currentMetrics.length > 0) {
      log(`Flushing batch of ${currentMetrics.length} metric messages`);
      await processTelemetryBatch(currentMetrics, { producer, clickhouse });
    }
    if (currentLogs.length > 0) {
      log(`Flushing batch of ${currentLogs.length} log messages`);
      await inserter.insertLogs(currentLogs.map(toLogsRawRow));
    }
    if (experienceBridge?.shouldFlush()) {
      await experienceBridge.flush();
    }
  };

  const scheduleFlush = (): void => {
    if (!flushTimer) {
      flushTimer = setTimeout(() => void flush(), BATCH_WINDOW_MS);
    }
  };

  await consumer.subscribe<TelemetryWorkerMessage>(
    [
      Topics.TELEMETRY_METRICS_RAW,
      Topics.TELEMETRY_LOGS_RAW,
      Topics.TELEMETRY_METADATA_RAW,
    ],
    async (message) => {
      if (message.topic === Topics.TELEMETRY_METRICS_RAW) {
        const metric = message.value as RawMetricMessage;
        experienceBridge?.observeMetric(metric);
        batch.push(metric);
        if (batch.length >= BATCH_MAX_SIZE) {
          await flush();
        } else {
          scheduleFlush();
        }
      } else if (message.topic === Topics.TELEMETRY_LOGS_RAW) {
        const logMessage = message.value as RawLogMessage;
        experienceBridge?.observeLog(logMessage);
        logBatch.push(logMessage);
        if (logBatch.length >= BATCH_MAX_SIZE) {
          await flush();
        } else {
          scheduleFlush();
        }
      } else if (message.topic === Topics.TELEMETRY_METADATA_RAW) {
        experienceBridge?.observeMetadata(message.value as RawMetadataMessage);
      }

      if (experienceBridge?.shouldFlush()) {
        await experienceBridge.flush();
      }
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await flush();
    await experienceBridge?.flush();
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

function toLogsRawRow(message: RawLogMessage): LogsRawRow {
  return {
    timestamp: new Date(message.timestamp),
    service_id: message.serviceId,
    service_type: message.serviceType,
    severity: inferSeverity(message.message),
    message: message.message,
    attributes: {
      ...(message.unit ? { unit: message.unit } : {}),
      ...(message.offset ? { offset: message.offset } : {}),
      ...(message.observedAt ? { observedAt: message.observedAt } : {}),
    },
    trace_id: "",
    span_id: "",
    environment: message.environment,
  };
}

function inferSeverity(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("exception") || lower.includes("failed")) {
    return "error";
  }
  if (lower.includes("warn")) return "warning";
  if (lower.includes("debug")) return "debug";
  return "info";
}
