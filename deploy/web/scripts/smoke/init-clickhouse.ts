/**
 * One-shot script: create all ClickHouse telemetry tables.
 * Safe to run repeatedly — all DDL uses IF NOT EXISTS.
 *
 * Usage (local):
 *   CLICKHOUSE_URL=http://localhost:8123 pnpm tsx scripts/smoke/init-clickhouse.ts
 *
 * Usage (Aiven):
 *   CLICKHOUSE_HOST=<host> CLICKHOUSE_PORT=8443 \
 *   CLICKHOUSE_USERNAME=cognitive-substrate-app CLICKHOUSE_PASSWORD=<pw> \
 *   CLICKHOUSE_DATABASE=cognitive_substrate_telemetry \
 *   pnpm tsx scripts/smoke/init-clickhouse.ts
 */

import { ClickHouseTelemetryClient } from "../../packages/clickhouse-telemetry/src/client.js";
import { ALL_DDL } from "../../packages/clickhouse-telemetry/src/schemas.js";

const log = (msg: string) =>
  process.stdout.write(`[clickhouse-init] ${msg}\n`);

const url = process.env["CLICKHOUSE_URL"];
const host = process.env["CLICKHOUSE_HOST"];
const port = process.env["CLICKHOUSE_PORT"]
  ? parseInt(process.env["CLICKHOUSE_PORT"], 10)
  : 8443;
const username = process.env["CLICKHOUSE_USERNAME"] ?? "default";
const password = process.env["CLICKHOUSE_PASSWORD"] ?? "";
const database = process.env["CLICKHOUSE_DATABASE"] ?? "cognitive_substrate_telemetry";

if (!url && !host) {
  process.stderr.write(
    "Set CLICKHOUSE_URL (e.g. http://localhost:8123) or CLICKHOUSE_HOST.\n"
  );
  process.exit(1);
}

const client = new ClickHouseTelemetryClient(
  url
    ? { url, username, password, database }
    : { host: host!, port, username, password, database }
);

async function run() {
  log(`Connecting to ClickHouse (${url ?? `${host}:${port}`})...`);

  for (const ddl of ALL_DDL) {
    // Extract table name for logging
    const match = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    const tableName = match?.[1] ?? "unknown";
    log(`Creating table: ${tableName}`);
    await client.client.command({ query: ddl });
  }

  log(`All ${ALL_DDL.length} tables created (or already exist).`);

  // Verify by listing tables
  const result = await client.client.query({
    query: `SHOW TABLES IN ${database}`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ name: string }>();
  log(`Tables in ${database}: ${rows.map((r) => r.name).join(", ")}`);

  await client.close();
}

run().catch((err: unknown) => {
  process.stderr.write(`[clickhouse-init] Error: ${String(err)}\n`);
  process.exit(1);
});
