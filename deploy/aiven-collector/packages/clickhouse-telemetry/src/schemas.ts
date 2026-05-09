/**
 * ClickHouse table definitions for the temporal telemetry layer.
 *
 * Design principles:
 *   - Every table is append-only (MergeTree / ReplacingMergeTree).
 *   - Partition key is always time-based to enable efficient TTL and
 *     range scans.
 *   - ORDER BY is chosen for the dominant query pattern, not insertion order.
 *   - LowCardinality() wraps string columns with bounded cardinality
 *     (enum-like values) to enable dictionary compression.
 *   - Map(String, String) holds variable-dimension labels without
 *     exploding column count.
 *
 * Table inventory:
 *   metrics_raw          — raw metric data points, 7-day hot tier
 *   logs_raw             — raw structured log records, 7-day hot tier
 *   traces_raw           — raw OTEL span data, 3-day hot tier
 *   cognitive_events     — operational primitive signals, long-term
 *   pattern_outcomes     — reinforcement feedback signals, long-term
 *   incident_reconstruction — full incident timelines for replay, long-term
 */

// ----------------------------------------------------------------
// TypeScript row types (mirror the DDL column list exactly)
// ----------------------------------------------------------------

export interface MetricsRawRow {
  timestamp: Date;
  service_id: string;
  service_type: string;
  metric_name: string;
  value: number;
  labels: Record<string, string>;
  environment: string;
}

export interface LogsRawRow {
  timestamp: Date;
  service_id: string;
  service_type: string;
  severity: string;
  message: string;
  attributes: Record<string, string>;
  trace_id: string;
  span_id: string;
  environment: string;
}

export interface TracesRawRow {
  timestamp: Date;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  service_id: string;
  operation_name: string;
  duration_ms: number;
  status: string;
  attributes: Record<string, string>;
  environment: string;
}

export interface CognitiveEventRow {
  timestamp: Date;
  primitive_id: string;
  intensity: number;
  trend: string;
  scope: string;
  confidence: number;
  source_system: string;
  source_system_type: string;
  correlated_signal_ids: string[];
  pattern_match_id: string | null;
  environment: string;
}

export interface PatternOutcomeRow {
  timestamp: Date;
  pattern_id: string;
  recommendation_id: string;
  action_taken: string;
  outcome: string;
  latency_delta_ms: number | null;
  confidence_before: number;
  confidence_after: number | null;
  environment: string;
}

export interface IncidentReconstructionRow {
  timestamp: Date;
  incident_id: string;
  event_type: string;
  primitive_id: string | null;
  pattern_id: string | null;
  raw_metric_name: string | null;
  raw_metric_value: number | null;
  source_system: string;
  payload_json: string;
  environment: string;
}

// ----------------------------------------------------------------
// DDL strings — executed once during schema migration
// ----------------------------------------------------------------

export const DDL_METRICS_RAW = `
/*
Dominant query patterns:
  1. Environment-scoped metric windows by service type, service, metric, and timestamp.
  2. Service-level anomaly scans over recent hot-tier data.
  3. Metric-name aggregation across services within one environment.
ORDER BY rationale:
  Low-cardinality environment and service_type lead the key before service_id,
  metric_name, and timestamp to improve pruning for environment-scoped scans.
*/
CREATE TABLE IF NOT EXISTS metrics_raw (
  timestamp          DateTime64(3, 'UTC'),
  service_id         String,
  service_type       LowCardinality(String),
  metric_name        LowCardinality(String),
  value              Float64,
  labels             Map(String, String),
  environment        LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, service_type, service_id, metric_name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;
`;

export const DDL_LOGS_RAW = `
/*
Dominant query patterns:
  1. Environment-scoped log windows by severity, service type, service, and timestamp.
  2. Incident triage scans for error and warning records during a time window.
  3. Trace or span correlation after a candidate incident window has been identified.
ORDER BY rationale:
  Environment, severity, and service_type are bounded-cardinality filters before
  service_id and timestamp. Trace identifiers remain columns for lookup and join
  correlation but do not lead the physical key.
*/
CREATE TABLE IF NOT EXISTS logs_raw (
  timestamp          DateTime64(3, 'UTC'),
  service_id         String,
  service_type       LowCardinality(String),
  severity           LowCardinality(String),
  message            String,
  attributes         Map(String, String),
  trace_id           String,
  span_id            String,
  environment        LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, severity, service_type, service_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;
`;

export const DDL_TRACES_RAW = `
/*
Dominant query patterns:
  1. Environment-scoped span windows by service, operation, status, and timestamp.
  2. Service latency analysis over the 3-day hot trace tier.
  3. Exact trace reconstruction after a trace_id has been surfaced by logs or UI.
ORDER BY rationale:
  Broad analytical scans use environment, status, service, and operation filters
  before timestamp. trace_id remains available for exact lookup but avoids leading
  the key with a near-unique identifier.
*/
CREATE TABLE IF NOT EXISTS traces_raw (
  timestamp          DateTime64(3, 'UTC'),
  trace_id           String,
  span_id            String,
  parent_span_id     String,
  service_id         String,
  operation_name     LowCardinality(String),
  duration_ms        Float32,
  status             LowCardinality(String),
  attributes         Map(String, String),
  environment        LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (environment, status, service_id, operation_name, timestamp, trace_id)
TTL toDateTime(timestamp) + INTERVAL 3 DAY
SETTINGS index_granularity = 8192;
`;

export const DDL_COGNITIVE_EVENTS = `
/*
Dominant query patterns:
  1. Environment-scoped primitive activity over recent and historical windows.
  2. Primitive trend and confidence analysis within one environment.
  3. Pattern matching by primitive_id after environment selection.
ORDER BY rationale:
  Environment is the most common tenant and deployment filter. primitive_id and
  timestamp follow to support primitive aggregations and bounded time scans.
*/
CREATE TABLE IF NOT EXISTS cognitive_events (
  timestamp              DateTime64(3, 'UTC'),
  primitive_id           LowCardinality(String),
  intensity              Float32,
  trend                  LowCardinality(String),
  scope                  LowCardinality(String),
  confidence             Float32,
  source_system          String,
  source_system_type     LowCardinality(String),
  correlated_signal_ids  Array(String),
  pattern_match_id       Nullable(String),
  environment            LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (environment, primitive_id, timestamp)
SETTINGS index_granularity = 8192;
`;

export const DDL_PATTERN_OUTCOMES = `
/*
Dominant query patterns:
  1. Environment-scoped outcome analysis by pattern over 30-day windows.
  2. Recommendation success-rate aggregation by pattern_id and action_taken.
  3. Confidence delta analysis over historical reinforcement feedback.
ORDER BY rationale:
  Environment leads broad analytical filters. pattern_id follows because most
  reinforcement queries group or filter by pattern before time-window analysis.
*/
CREATE TABLE IF NOT EXISTS pattern_outcomes (
  timestamp            DateTime64(3, 'UTC'),
  pattern_id           String,
  recommendation_id    String,
  action_taken         LowCardinality(String),
  outcome              LowCardinality(String),
  latency_delta_ms     Nullable(Int32),
  confidence_before    Float32,
  confidence_after     Nullable(Float32),
  environment          LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (environment, pattern_id, timestamp)
SETTINGS index_granularity = 8192;
`;

export const DDL_INCIDENT_RECONSTRUCTION = `
/*
Dominant query patterns:
  1. Incident replay by environment, incident_id, and timestamp.
  2. Incident timeline scans by event_type within one environment.
  3. Pattern or primitive correlation after an incident has been selected.
ORDER BY rationale:
  Environment scopes replay queries before incident_id. incident_id remains early
  because this table is optimized for exact incident reconstruction rather than
  broad telemetry exploration.
*/
CREATE TABLE IF NOT EXISTS incident_reconstruction (
  timestamp          DateTime64(3, 'UTC'),
  incident_id        String,
  event_type         LowCardinality(String),
  primitive_id       LowCardinality(Nullable(String)),
  pattern_id         Nullable(String),
  raw_metric_name    LowCardinality(Nullable(String)),
  raw_metric_value   Nullable(Float64),
  source_system      String,
  payload_json       String,
  environment        LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (environment, incident_id, timestamp)
SETTINGS index_granularity = 8192;
`;

export const ALL_DDL = [
  DDL_METRICS_RAW,
  DDL_LOGS_RAW,
  DDL_TRACES_RAW,
  DDL_COGNITIVE_EVENTS,
  DDL_PATTERN_OUTCOMES,
  DDL_INCIDENT_RECONSTRUCTION,
] as const;
