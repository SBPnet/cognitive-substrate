import {
  CognitiveProducer,
  Topics,
  createKafkaClient,
  ensureKafkaTopics,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  initTelemetry,
  telemetryConfigFromEnv,
  AivenCollectorMetrics,
} from "@cognitive-substrate/telemetry-otel";
import { AivenClient, type AivenService } from "./aiven-client.js";
import { collectorConfigFromEnv, type AivenCollectorConfig } from "./config.js";
import { startPrometheusReceiver } from "./prometheus-receiver.js";
import { startLogConsumer } from "./log-consumer.js";
import type { RawMetadataMessage } from "./messages.js";

export async function startWorker(): Promise<void> {
  const shutdownTelemetry = await initTelemetry(
    telemetryConfigFromEnv("aiven-collector-worker"),
  );
  const config = collectorConfigFromEnv();
  const log = logger("aiven-collector-worker");

  const kafkaConfig = kafkaConfigFromEnv();
  log("Ensuring Kafka telemetry topics exist...");
  await ensureKafkaTopics(kafkaConfig, [
    Topics.TELEMETRY_METRICS_RAW,
    Topics.TELEMETRY_LOGS_RAW,
    Topics.TELEMETRY_METADATA_RAW,
    Topics.TELEMETRY_EVENTS_NORMALIZED,
    Topics.COGNITION_PRIMITIVES,
  ]);

  const kafka = createKafkaClient({ ...kafkaConfig, clientId: config.kafkaClientId });
  // High-volume telemetry tier: audit mirroring would double every metric,
  // log, and metadata message; the raw telemetry topics are the durable record.
  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  const workerMetrics = new AivenCollectorMetrics();
  const client = new AivenClient(config.apiBaseUrl, config.token, config.project);
  let shuttingDown = false;

  // -- Push receivers --------------------------------------------------

  // Prometheus remote_write: Aiven pushes metrics here instead of being polled.
  const stopPrometheusReceiver = startPrometheusReceiver(
    {
      port: config.prometheusReceiverPort,
      environment: config.environment,
      serviceLabel: "aiven_service",
      serviceTypeLabel: "aiven_service_type",
    },
    producer,
    log,
    workerMetrics,
  );

  // Kafka log consumer: reads from aiven.logs.* topics populated by the
  // Aiven kafka_logs service integration (one topic per service).
  const stopLogConsumer = await startLogConsumer(
    {
      kafkaClientId: config.kafkaClientId,
      kafkaGroupId: config.kafkaLogsGroupId,
      logsTopicPrefix: config.logsTopicPrefix,
      environment: config.environment,
    },
    producer,
    log,
  );

  // -- Metadata polling ------------------------------------------------
  // Service state snapshots (plan, cloud, state, config) are not available
  // via push; a low-frequency poll is acceptable and keeps the metadata
  // index fresh without requiring a push integration for this data type.

  const runSafe = async (name: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error: unknown) {
      log(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const metadataPoll = (): Promise<void> => collectMetadata(config, client, producer, log, workerMetrics);

  await runSafe("metadata", metadataPoll);

  if (config.once) {
    stopPrometheusReceiver();
    await stopLogConsumer();
    await producer.disconnect();
    await shutdownTelemetry();
    return;
  }

  const metadataInterval = setInterval(
    () => void runSafe("metadata", metadataPoll),
    config.metadataIntervalMs,
  );

  const handleShutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Shutting down...");
    clearInterval(metadataInterval);
    stopPrometheusReceiver();
    await stopLogConsumer();
    await producer.disconnect();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Prometheus receiver and Kafka log consumer are live.");
}

async function collectMetadata(
  config: AivenCollectorConfig,
  client: AivenClient,
  producer: CognitiveProducer,
  log: (message: string) => void,
  workerMetrics?: AivenCollectorMetrics,
): Promise<void> {
  const services = await resolveServices(config, client);
  const observedAt = new Date().toISOString();

  for (const service of services) {
    workerMetrics?.metadataPublished.add(1);
    const message: RawMetadataMessage = {
      project: config.project,
      serviceId: service.service_name,
      source: "aiven.service",
      snapshot: service,
      timestamp: service.update_time ?? service.create_time ?? observedAt,
      environment: config.environment,
      ...(service.service_type ? { serviceType: service.service_type } : {}),
    };
    await producer.publish(Topics.TELEMETRY_METADATA_RAW, message, {
      key: service.service_name,
    });
  }

  log(`Published metadata for ${services.length} Aiven services`);
}

async function resolveServices(
  config: AivenCollectorConfig,
  client: AivenClient,
): Promise<readonly AivenService[]> {
  if (config.services.length === 0) return client.listServices();
  return Promise.all(config.services.map((serviceName) => client.getService(serviceName)));
}

function logger(serviceName: string): (message: string) => void {
  return (message: string): void => {
    process.stdout.write(`[${serviceName}] ${new Date().toISOString()} ${message}\n`);
  };
}
