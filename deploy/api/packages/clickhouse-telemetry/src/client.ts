import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ALL_DDL } from "./schemas.js";

export interface ClickHouseTelemetryConfig {
  /**
   * Full base URL override, e.g. "http://localhost:8123" (local dev) or
   * "https://host:8443" (Aiven). When provided, `host` and `port` are ignored.
   */
  url?: string;
  /** ClickHouse host, e.g. "abc123.aivencloud.com". Ignored when `url` is set. */
  host?: string;
  /** Port, typically 8443 on Aiven or 8123 locally. Ignored when `url` is set. */
  port?: number;
  username: string;
  password: string;
  database: string;
  /**
   * Server-side async insert flush timeout for small batches in milliseconds.
   * Defaults to 1000 ms to bound ingestion latency while avoiding tiny parts.
   */
  asyncInsertBusyTimeoutMs?: number;
  /**
   * Server-side async insert buffer size in bytes. Defaults to 10 MB.
   */
  asyncInsertMaxDataSize?: number;
}

/**
 * Thin wrapper around the official @clickhouse/client that:
 *   - enforces the `cognitive_substrate_telemetry` database context
 *   - exposes a `ensureTables()` helper for schema migration
 *   - exposes the underlying client for direct queries
 */
export class ClickHouseTelemetryClient {
  readonly client: ClickHouseClient;
  private readonly database: string;

  constructor(config: ClickHouseTelemetryConfig) {
    if (!config.url && !config.host) {
      throw new Error(
        "ClickHouseTelemetryConfig requires either `url` or `host`"
      );
    }
    this.database = config.database;
    const url =
      config.url ?? `https://${config.host!}:${config.port ?? 8443}`;
    this.client = createClient({
      url,
      username: config.username,
      password: config.password,
      database: config.database,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_busy_timeout_ms: config.asyncInsertBusyTimeoutMs ?? 1000,
        async_insert_max_data_size: String(
          config.asyncInsertMaxDataSize ?? 10_000_000
        ),
      },
    });
  }

  /**
   * Create all telemetry tables if they do not already exist.
   * Safe to call on every startup — all DDL uses IF NOT EXISTS.
   */
  async ensureTables(): Promise<void> {
    for (const ddl of ALL_DDL) {
      await this.client.command({ query: ddl });
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Build a ClickHouseTelemetryClient from environment variables.
 *
 * Supported variable sets (in priority order):
 *
 * 1. Full URL override (local dev or any non-standard endpoint):
 *      CLICKHOUSE_URL=http://localhost:8123
 *      CLICKHOUSE_USERNAME=default   (optional, defaults to "default")
 *      CLICKHOUSE_PASSWORD=          (optional, defaults to "")
 *      CLICKHOUSE_DATABASE=cognitive_substrate_telemetry (optional)
 *
 * 2. Host + port (Aiven HTTPS):
 *      CLICKHOUSE_HOST=<host>
 *      CLICKHOUSE_PORT=8443
 *      CLICKHOUSE_USERNAME=cognitive-substrate-app
 *      CLICKHOUSE_PASSWORD=<password>
 *      CLICKHOUSE_DATABASE=cognitive_substrate_telemetry (optional)
 */
export function createTelemetryClientFromEnv(): ClickHouseTelemetryClient {
  const url = process.env["CLICKHOUSE_URL"];
  const database =
    process.env["CLICKHOUSE_DATABASE"] ?? "cognitive_substrate_telemetry";
  const username = process.env["CLICKHOUSE_USERNAME"] ?? "default";
  const password = process.env["CLICKHOUSE_PASSWORD"] ?? "";

  if (url) {
    return new ClickHouseTelemetryClient({ url, username, password, database });
  }

  return new ClickHouseTelemetryClient({
    host: requireEnv("CLICKHOUSE_HOST"),
    port: parseInt(requireEnv("CLICKHOUSE_PORT"), 10),
    username,
    password,
    database,
  });
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}
