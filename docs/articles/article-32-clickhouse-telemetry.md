# Stage 31: ClickHouse Telemetry Layer

*This article accompanies Stage 31 of the cognitive-substrate project. It describes the temporal telemetry substrate used by the operational intelligence pipeline: an Aiven ClickHouse service, append-only schemas for raw and cognitive telemetry, and a typed client package that gives the workers a stable write path.*

## Why operational intelligence needs ClickHouse

Operational intelligence begins with a storage asymmetry. The cognitive architecture already uses OpenSearch for associative recall, vector retrieval, and pattern documents. That store is appropriate for semantic memory, but it is not the right substrate for high-volume telemetry streams. Raw metrics, logs, and traces arrive continuously, are scanned by time window, and are usually aggregated rather than retrieved by semantic similarity.

ClickHouse fills this role. It stores the temporal record of infrastructure behaviour: what happened, when it happened, which service emitted the signal, and which later cognitive artifact was derived from it. The layer is intentionally append-only. Workers write facts and outcomes; later systems aggregate, replay, and compare them.

## Table design

The schema in `packages/clickhouse-telemetry/src/schemas.ts` defines six tables in the `cognitive_substrate_telemetry` database.

The hot tier stores raw telemetry. `metrics_raw` records raw metric data points for seven days. `logs_raw` records structured logs for seven days. `traces_raw` records OpenTelemetry span data for three days, because trace volume is high and its operational value is concentrated near incidents.

The cognitive tier stores compressed signals. `cognitive_events` records operational primitive events produced by the telemetry worker. `pattern_outcomes` records reinforcement feedback for recommendations. These tables have long retention because they are the learning substrate, not merely debugging evidence.

The replay tier stores incident timelines. `incident_reconstruction` links raw metrics, primitive events, pattern matches, recommendations, and operator actions under a shared `incident_id`. This enables retrospective replay when mappings or patterns change.

## Physical layout

Every table uses a time-based partition key and an `ORDER BY` clause aligned with its dominant query pattern. Raw metrics are ordered by `(service_id, metric_name, timestamp)`, cognitive events by `(primitive_id, timestamp)`, pattern outcomes by `(pattern_id, timestamp)`, and incident reconstruction rows by `(incident_id, timestamp)`.

This design makes the common questions inexpensive:

- Which primitives were active in a recent time window.
- Which recommendations improved outcomes for a pattern.
- Which raw signals contributed to an incident.
- Whether a new mapping would have changed a historical diagnosis.

The schema uses `LowCardinality(String)` for bounded categorical fields and `Map(String, String)` for variable telemetry labels. That keeps the core schema stable while preserving vendor-specific metadata in raw rows.

## Worker integration

The `ClickHouseTelemetryClient` wraps the official ClickHouse client and enforces the database context. The client enables asynchronous inserts and exposes `ensureTables()`, allowing worker startup to run idempotent schema creation.

The `TelemetryInserter` provides typed insert methods for each table. This keeps SQL string construction out of the worker code and makes table shape changes visible at compile time through TypeScript row interfaces.

The telemetry worker writes every raw metric batch to `metrics_raw` before normalisation. After operational primitives are produced, it writes `cognitive_events`. The reinforcement worker writes pending and completed recommendation outcomes to `pattern_outcomes`. Future incident reconstruction jobs can append full timelines without altering the real-time workers.

## Why raw and cognitive stores are separated

Raw telemetry is noisy, high-volume, and short-lived. Cognitive telemetry is compressed, lower-volume, and accumulates learning value. Combining both tiers in a single table would either retain too much raw data indefinitely or discard the very signals needed for reinforcement.

The separation allows raw data to expire aggressively while preserving the signals that matter for memory and learning. It also keeps replay possible: the incident table can preserve selected raw context around important events without requiring indefinite retention of every metric point.

## Artifacts (Tier A)

**Stage covered:** 31, ClickHouse Telemetry Layer.

**Packages shipped:** `packages/clickhouse-telemetry/` provides schema definitions, typed row interfaces, the `ClickHouseTelemetryClient`, and typed inserter helpers.

**Infrastructure:** `infra/aiven/clickhouse.tf` provisions the Aiven ClickHouse service and integration surface for the telemetry database.

**Tier B:** End-to-end evidence requires a live Aiven ClickHouse service and Kafka telemetry stream. Representative schema and query paths are documented in `docs/architecture/clickhouse-telemetry.md`.

**Quantitative claims:** Claims about storage volume, latency, or query performance remain design expectations pending benchmark evidence.

*Source code: `packages/clickhouse-telemetry/` and `infra/aiven/clickhouse.tf`. Architecture documentation: `docs/architecture/clickhouse-telemetry.md`. Companion paper chapter: `docs/paper/25-telemetry-substrate.md`.*
