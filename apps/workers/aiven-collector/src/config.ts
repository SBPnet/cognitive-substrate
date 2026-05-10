export interface AivenCollectorConfig {
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly project: string;
  readonly services: readonly string[];
  readonly environment: string;
  readonly kafkaClientId: string;
  readonly metadataIntervalMs: number;
  readonly logsIntervalMs: number;
  readonly metricsIntervalMs: number;
  readonly eventsIntervalMs: number;
  readonly logLimit: number;
  readonly once: boolean;
}

export function collectorConfigFromEnv(): AivenCollectorConfig {
  const token = requiredEnv("AIVEN_TOKEN");
  const project = requiredEnv("AIVEN_PROJECT");
  const services = csv(process.env["AIVEN_SERVICES"]);

  return {
    apiBaseUrl: process.env["AIVEN_API_BASE_URL"] ?? "https://api.aiven.io/v1",
    token,
    project,
    services,
    environment: process.env["ENVIRONMENT"] ?? project,
    kafkaClientId: process.env["KAFKA_CLIENT_ID"] ?? "aiven-collector-worker",
    metadataIntervalMs: positiveInteger("AIVEN_METADATA_INTERVAL_MS", 60_000),
    logsIntervalMs: positiveInteger("AIVEN_LOGS_INTERVAL_MS", 15_000),
    metricsIntervalMs: positiveInteger("AIVEN_METRICS_INTERVAL_MS", 30_000),
    eventsIntervalMs: positiveInteger("AIVEN_EVENTS_INTERVAL_MS", 60_000),
    logLimit: positiveInteger("AIVEN_LOG_LIMIT", 100),
    once: process.env["AIVEN_COLLECTOR_ONCE"] === "true",
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function csv(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
