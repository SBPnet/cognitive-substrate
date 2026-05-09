import type { ClickHouseTelemetryClient } from "./client.js";
import type {
  MetricsRawRow,
  LogsRawRow,
  TracesRawRow,
  CognitiveEventRow,
  PatternOutcomeRow,
  IncidentReconstructionRow,
} from "./schemas.js";

export interface TelemetryInserterOptions {
  /**
   * Advisory lower bound from ClickHouse insert guidance. Small batches are
   * allowed when async inserts are enabled, but strict mode can reject them.
   */
  minRecommendedBatchSize?: number;
  /** Hard upper bound per INSERT request. Larger arrays are chunked. */
  maxRowsPerInsert?: number;
  /** Reject non-empty batches below minRecommendedBatchSize. */
  strictBatchSize?: boolean;
}

const DEFAULT_MIN_RECOMMENDED_BATCH_SIZE = 1_000;
const DEFAULT_MAX_ROWS_PER_INSERT = 100_000;

/**
 * Typed batch insert helpers for each telemetry table.
 *
 * Callers should accumulate rows and flush on a timer or size threshold rather
 * than inserting one row at a time. The client enables async_insert with
 * wait_for_async_insert so small batches remain durable while server-side
 * buffering reduces part pressure.
 */
export class TelemetryInserter {
  private readonly minRecommendedBatchSize: number;
  private readonly maxRowsPerInsert: number;
  private readonly strictBatchSize: boolean;

  constructor(
    private readonly ch: ClickHouseTelemetryClient,
    options: TelemetryInserterOptions = {}
  ) {
    this.minRecommendedBatchSize =
      options.minRecommendedBatchSize ?? DEFAULT_MIN_RECOMMENDED_BATCH_SIZE;
    this.maxRowsPerInsert =
      options.maxRowsPerInsert ?? DEFAULT_MAX_ROWS_PER_INSERT;
    this.strictBatchSize = options.strictBatchSize ?? false;
  }

  async insertMetrics(rows: MetricsRawRow[]): Promise<void> {
    await this.insertRows("metrics_raw", rows, toMetricsRow);
  }

  async insertLogs(rows: LogsRawRow[]): Promise<void> {
    await this.insertRows("logs_raw", rows, toLogsRow);
  }

  async insertTraces(rows: TracesRawRow[]): Promise<void> {
    await this.insertRows("traces_raw", rows, toTracesRow);
  }

  async insertCognitiveEvents(rows: CognitiveEventRow[]): Promise<void> {
    await this.insertRows("cognitive_events", rows, toCognitiveEventRow);
  }

  async insertPatternOutcomes(rows: PatternOutcomeRow[]): Promise<void> {
    await this.insertRows("pattern_outcomes", rows, toPatternOutcomeRow);
  }

  async insertIncidentEvents(rows: IncidentReconstructionRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.insertRows("incident_reconstruction", rows, toIncidentRow);
  }

  private async insertRows<T>(
    table: string,
    rows: T[],
    serialize: (row: T) => Record<string, unknown>
  ): Promise<void> {
    if (rows.length === 0) return;
    if (
      this.strictBatchSize &&
      rows.length < this.minRecommendedBatchSize
    ) {
      throw new Error(
        `ClickHouse batch for ${table} has ${rows.length} rows; minimum is ${this.minRecommendedBatchSize}`
      );
    }

    for (let start = 0; start < rows.length; start += this.maxRowsPerInsert) {
      const chunk = rows.slice(start, start + this.maxRowsPerInsert);
      await this.ch.client.insert({
        table,
        values: chunk.map(serialize),
        format: "JSONEachRow",
      });
    }
  }
}

// ----------------------------------------------------------------
// Row serialisers — convert typed objects to the flat JSON shape
// that ClickHouse expects for JSONEachRow format
// ----------------------------------------------------------------

function toMetricsRow(r: MetricsRawRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    service_id: r.service_id,
    service_type: r.service_type,
    metric_name: r.metric_name,
    value: r.value,
    labels: r.labels,
    environment: r.environment,
  };
}

function toLogsRow(r: LogsRawRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    service_id: r.service_id,
    service_type: r.service_type,
    severity: r.severity,
    message: r.message,
    attributes: r.attributes,
    trace_id: r.trace_id,
    span_id: r.span_id,
    environment: r.environment,
  };
}

function toTracesRow(r: TracesRawRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    trace_id: r.trace_id,
    span_id: r.span_id,
    parent_span_id: r.parent_span_id,
    service_id: r.service_id,
    operation_name: r.operation_name,
    duration_ms: r.duration_ms,
    status: r.status,
    attributes: r.attributes,
    environment: r.environment,
  };
}

function toCognitiveEventRow(r: CognitiveEventRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    primitive_id: r.primitive_id,
    intensity: r.intensity,
    trend: r.trend,
    scope: r.scope,
    confidence: r.confidence,
    source_system: r.source_system,
    source_system_type: r.source_system_type,
    correlated_signal_ids: r.correlated_signal_ids,
    pattern_match_id: r.pattern_match_id ?? null,
    environment: r.environment,
  };
}

function toPatternOutcomeRow(r: PatternOutcomeRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    pattern_id: r.pattern_id,
    recommendation_id: r.recommendation_id,
    action_taken: r.action_taken,
    outcome: r.outcome,
    latency_delta_ms: r.latency_delta_ms ?? null,
    confidence_before: r.confidence_before,
    confidence_after: r.confidence_after ?? null,
    environment: r.environment,
  };
}

function toIncidentRow(r: IncidentReconstructionRow): Record<string, unknown> {
  return {
    timestamp: toClickHouseTimestamp(r.timestamp),
    incident_id: r.incident_id,
    event_type: r.event_type,
    primitive_id: r.primitive_id ?? null,
    pattern_id: r.pattern_id ?? null,
    raw_metric_name: r.raw_metric_name ?? null,
    raw_metric_value: r.raw_metric_value ?? null,
    source_system: r.source_system,
    payload_json: r.payload_json,
    environment: r.environment,
  };
}

function toClickHouseTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
