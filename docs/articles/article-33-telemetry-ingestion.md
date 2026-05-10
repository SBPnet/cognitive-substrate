# Stage 32: Telemetry Ingestion Worker

*This article accompanies Stage 32 of the cognitive-substrate project. It describes the worker that converts raw infrastructure metrics into operational primitive events while preserving the original telemetry record in ClickHouse.*

## From metrics to cognitive events

The telemetry ingestion worker is the first executable bridge between observability data and the cognitive architecture. Raw metric messages arrive on `telemetry.metrics.raw`. Each message names a service, service type, metric name, value, timestamp, environment, and optional labels, baseline, and previous value.

The worker performs two acts at once. It preserves the raw signal in ClickHouse, then translates the signal into the operational primitive vocabulary introduced in Stage 30. The first act protects replay and auditability. The second act makes the signal useful to pattern detection.

## Batch processing path

The core implementation lives in `apps/workers/telemetry/src/pipeline.ts`. A batch is processed in four stages.

First, every input message is written to `metrics_raw`. The row preserves `service_id`, `service_type`, `metric_name`, numeric value, labels, timestamp, and environment. This write happens before mapping so discarded or unmapped signals remain available for mapping analysis.

Second, messages are grouped by inferred system identifier. Kafka, OpenSearch, PostgreSQL, and ClickHouse services resolve to built-in Aiven mappings. Additional mappings can be supplied through `extraMappings`, which lets a deployment add new system types without rebuilding the worker package.

Third, each group is passed through `normaliseSignals()`. The normaliser resolves metric names to primitive identifiers, computes intensity, derives trend from the previous value, infers scope from labels, and assigns confidence based on whether resolution was exact or wildcard-based.

Fourth, the worker writes `cognitive_events` to ClickHouse and publishes two Kafka streams: `telemetry.events.normalized` for resolved raw telemetry and `cognition.primitives` for downstream cognitive consumers.

## Intentional discard semantics

Signals with no mapping do not become primitive events. This is an intentional boundary, not an error. Pattern detection relies on a stable vocabulary, and unmapped metrics would introduce noise if they were forced into weak categories.

The raw row is still stored. That creates a feedback path for mapping maintenance: unmapped metric names can be analyzed later, added to a `SystemMapping`, and replayed through the updated pipeline when needed.

## Why the worker publishes two streams

`telemetry.events.normalized` retains the relationship between a raw metric and the primitives it resolved to. It is useful for dashboards, mapping validation, and debugging.

`cognition.primitives` is smaller and more abstract. It carries only the primitive event fields required by the pattern worker: primitive identifier, intensity, trend, scope, confidence, source system, correlated signal identifiers, and timestamp.

Separating the streams keeps the pattern detector independent from raw metric vocabulary. It also lets operational dashboards show the translation step without coupling the detector to presentation concerns.

## Mapping extensibility

The worker uses built-in mappings from `packages/abstraction-engine/src/primitives/mapping-layer.ts`. The same interface accepts deployment-specific mappings. Exact metric names take priority over wildcard patterns, allowing precise overrides without losing broad coverage.

This extension point is the operational form of the transfer mechanism. Onboarding a new system requires a mapping, not a new detector. Once the mapping produces primitive events, existing pattern knowledge can operate immediately.

## Artifacts (Tier A)

**Stage covered:** 32, Telemetry Ingestion Worker.

**Packages shipped:** `apps/workers/telemetry/` implements the worker and batch pipeline. `packages/abstraction-engine/src/primitives/` provides the normaliser and mappings. `packages/clickhouse-telemetry/` provides typed ClickHouse writes.

**Kafka topics:** The worker consumes `telemetry.metrics.raw` and emits `telemetry.events.normalized` and `cognition.primitives`.

**Tier B:** A representative end-to-end run requires a live Kafka topic and ClickHouse service. The processing contract is documented in `docs/architecture/operational-primitives.md` and `docs/architecture/clickhouse-telemetry.md`.

**Quantitative claims:** Throughput and mapping coverage claims remain pending production telemetry evidence.

*Source code: `apps/workers/telemetry/`, `packages/abstraction-engine/src/primitives/`, and `packages/clickhouse-telemetry/`. Architecture documentation: `docs/architecture/operational-primitives.md` and `docs/architecture/clickhouse-telemetry.md`. Companion paper chapter: `docs/paper/26-telemetry-normalisation.md`.*
