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
} from "@cognitive-substrate/telemetry-otel";
import { AivenClient, type AivenLogEntry, type AivenService } from "./aiven-client.js";
import { collectorConfigFromEnv, type AivenCollectorConfig } from "./config.js";
import { normalizeAivenMetrics } from "./metrics.js";
import type { RawLogMessage, RawMetadataMessage } from "./messages.js";

const logOffsets = new Map<string, string>();
const seenProjectEvents = new Set<string>();

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

  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: process.env["KAFKA_CLIENT_ID"] ?? "aiven-collector-worker",
  });
  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  const client = new AivenClient(config.apiBaseUrl, config.token, config.project);
  let shuttingDown = false;

  const runSafe = async (name: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error: unknown) {
      log(`${name} poll failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const metadataPoll = (): Promise<void> => collectMetadata(config, client, producer, log);
  const logsPoll = (): Promise<void> => collectLogs(config, client, producer, log);
  const metricsPoll = (): Promise<void> => collectMetrics(config, client, producer, log);
  const eventsPoll = (): Promise<void> => collectProjectEvents(config, client, producer, log);

  await runSafe("metadata", metadataPoll);
  await runSafe("events", eventsPoll);
  await runSafe("logs", logsPoll);
  await runSafe("metrics", metricsPoll);

  if (config.once) {
    await producer.disconnect();
    await shutdownTelemetry();
    return;
  }

  const intervals = [
    setInterval(() => void runSafe("metadata", metadataPoll), config.metadataIntervalMs),
    setInterval(() => void runSafe("events", eventsPoll), config.eventsIntervalMs),
    setInterval(() => void runSafe("logs", logsPoll), config.logsIntervalMs),
    setInterval(() => void runSafe("metrics", metricsPoll), config.metricsIntervalMs),
  ];

  const handleShutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Shutting down...");
    intervals.forEach((interval) => clearInterval(interval));
    await producer.disconnect();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Polling Aiven telemetry APIs...");
}

async function collectMetadata(
  config: AivenCollectorConfig,
  client: AivenClient,
  producer: CognitiveProducer,
  log: (message: string) => void,
): Promise<void> {
  const services = await resolveServices(config, client);
  const observedAt = new Date().toISOString();

  for (const service of services) {
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

async function collectProjectEvents(
  config: AivenCollectorConfig,
  client: AivenClient,
  producer: CognitiveProducer,
  log: (message: string) => void,
): Promise<void> {
  const events = await client.getProjectEvents();
  let published = 0;

  for (const event of events) {
    const eventId =
      event.id ??
      `${event.service_name ?? "project"}:${event.event_type ?? "event"}:${event.time ?? ""}:${event.event_desc ?? ""}`;
    if (seenProjectEvents.has(eventId)) continue;
    seenProjectEvents.add(eventId);

    const message: RawMetadataMessage = {
      project: config.project,
      source: "aiven.project_event",
      snapshot: event,
      timestamp: event.time ?? new Date().toISOString(),
      environment: config.environment,
      ...(event.service_name ? { serviceId: event.service_name } : {}),
    };
    await producer.publish(Topics.TELEMETRY_METADATA_RAW, message, { key: eventId });
    published += 1;
  }

  log(`Published ${published} new Aiven project events`);
}

async function collectLogs(
  config: AivenCollectorConfig,
  client: AivenClient,
  producer: CognitiveProducer,
  log: (message: string) => void,
): Promise<void> {
  const services = await resolveServices(config, client);
  let published = 0;

  for (const service of services) {
    const serviceName = service.service_name;
    const response = await client.getServiceLogs(
      serviceName,
      config.logLimit,
      logOffsets.get(serviceName),
    );

    for (const entry of response.logs ?? []) {
      await producer.publish(Topics.TELEMETRY_LOGS_RAW, logMessage(config, service, entry, response.offset), {
        key: serviceName,
      });
      published += 1;
    }

    if (response.offset) {
      logOffsets.set(serviceName, response.offset);
    }
  }

  log(`Published ${published} Aiven log records`);
}

async function collectMetrics(
  config: AivenCollectorConfig,
  client: AivenClient,
  producer: CognitiveProducer,
  log: (message: string) => void,
): Promise<void> {
  const services = await resolveServices(config, client);
  let published = 0;

  for (const service of services) {
    const serviceType = service.service_type ?? "unknown";
    const observedAt = new Date().toISOString();
    const payloads: Array<{ source: "managed" | "application"; payload: unknown }> = [];

    await collectOptionalMetricPayload(
      "managed",
      () => client.getManagedServiceMetrics(service.service_name),
      payloads,
      log,
    );
    if (serviceType === "application") {
      await collectOptionalMetricPayload("application", () => client.getApplicationMetrics(service.service_name), payloads, log);
    }

    for (const { source, payload } of payloads) {
      const metrics = normalizeAivenMetrics({
        serviceId: service.service_name,
        serviceType,
        environment: config.environment,
        payload,
        observedAt,
        source,
      });

      for (const metric of metrics) {
        await producer.publish(Topics.TELEMETRY_METRICS_RAW, metric, {
          key: `${metric.serviceId}:${metric.metricName}`,
        });
        published += 1;
      }
    }
  }

  log(`Published ${published} Aiven metric records`);
}

async function collectOptionalMetricPayload(
  source: "managed" | "application",
  read: () => Promise<unknown>,
  payloads: Array<{ source: "managed" | "application"; payload: unknown }>,
  log: (message: string) => void,
): Promise<void> {
  try {
    payloads.push({ source, payload: await read() });
  } catch (error: unknown) {
    log(`${source} metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveServices(
  config: AivenCollectorConfig,
  client: AivenClient,
): Promise<readonly AivenService[]> {
  if (config.services.length === 0) return client.listServices();
  return Promise.all(config.services.map((serviceName) => client.getService(serviceName)));
}

function logMessage(
  config: AivenCollectorConfig,
  service: AivenService,
  entry: AivenLogEntry,
  offset?: string,
): RawLogMessage {
  const timestamp = entry.time ?? new Date().toISOString();
  return {
    project: config.project,
    serviceId: service.service_name,
    serviceType: service.service_type ?? "unknown",
    message: entry.msg ?? entry.message ?? JSON.stringify(entry),
    timestamp,
    observedAt: new Date().toISOString(),
    environment: config.environment,
    ...(entry.unit ? { unit: entry.unit } : {}),
    ...(offset ? { offset } : {}),
  };
}

function logger(serviceName: string): (message: string) => void {
  return (message: string): void => {
    process.stdout.write(`[${serviceName}] ${new Date().toISOString()} ${message}\n`);
  };
}
