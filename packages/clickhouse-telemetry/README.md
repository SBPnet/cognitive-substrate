# @cognitive-substrate/clickhouse-telemetry

ClickHouse client, table schemas, and typed batch inserters for cognitive telemetry events.

## What it does

Wraps the ClickHouse HTTP client with typed inserters for four telemetry event categories: metrics, logs, traces, and metadata. Table schemas are defined here as the single source of truth and used at migration time to create or update ClickHouse tables.

This package is used by workers that emit high-volume, time-series telemetry that would be too expensive to route through OpenSearch.

## API

```ts
import { ClickHouseClient, insertMetrics, insertLogs } from '@cognitive-substrate/clickhouse-telemetry';

const client = new ClickHouseClient({ url: process.env.CLICKHOUSE_URL });
await insertMetrics(client, metricRows);
await insertLogs(client, logRows);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ClickHouseClient` | Thin wrapper around `@clickhouse/client` |
| `insertMetrics` | Typed batch insert for metric rows |
| `insertLogs` | Typed batch insert for log rows |
| `insertTraces` | Typed batch insert for trace rows |
| `SCHEMAS` | Table DDL strings used during migration |

## Dependencies

- `@clickhouse/client` — official ClickHouse HTTP client

## Configuration

| Env var | Description |
| ------- | ----------- |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_DATABASE` | Target database name |
