/**
 * Worker runtime metrics.
 *
 * Every worker constructs a WorkerMetrics instance at startup and calls its
 * methods around each unit of work. Instruments are OTLP-exported on the
 * interval configured in bootstrap (default 30s), which feeds the Prometheus
 * remote_write receiver → TELEMETRY_METRICS_RAW → ClickHouse pipeline the
 * same way Aiven service metrics do.
 *
 * Naming follows the OTel semantic conventions (snake_case, unit suffix):
 *   worker.messages.processed      — Counter
 *   worker.message.duration_ms     — Histogram (processing latency)
 *   worker.errors                  — Counter
 *   worker.<domain>.*              — worker-specific instruments added below
 */

import { metrics, type Meter, type Counter, type Histogram, type UpDownCounter } from "@opentelemetry/api";

export function getMeter(name: string, version = "0.1.0"): Meter {
  return metrics.getMeterProvider().getMeter(name, version);
}

/** Common runtime instruments shared by all workers. */
export class WorkerMetrics {
  readonly messagesProcessed: Counter;
  readonly messageDurationMs: Histogram;
  readonly errors: Counter;

  constructor(workerName: string) {
    const meter = getMeter(workerName);

    this.messagesProcessed = meter.createCounter("worker.messages.processed", {
      description: "Total number of Kafka messages successfully processed",
      unit: "{message}",
    });

    this.messageDurationMs = meter.createHistogram("worker.message.duration_ms", {
      description: "Processing latency per Kafka message in milliseconds",
      unit: "ms",
      advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] },
    });

    this.errors = meter.createCounter("worker.errors", {
      description: "Total number of message processing errors",
      unit: "{error}",
    });
  }

  /** Call at the start of processing; returns a function that records duration and increments processed count. */
  startMessage(attributes: Record<string, string> = {}): (error?: unknown) => void {
    const start = performance.now();
    return (error?: unknown) => {
      const durationMs = performance.now() - start;
      this.messageDurationMs.record(durationMs, attributes);
      if (error !== undefined) {
        this.errors.add(1, attributes);
      } else {
        this.messagesProcessed.add(1, attributes);
      }
    };
  }
}

/** Additional instruments for the ingestion worker. */
export class IngestionMetrics extends WorkerMetrics {
  readonly embeddingDurationMs: Histogram;
  readonly opensearchWriteDurationMs: Histogram;
  readonly importanceScore: Histogram;

  constructor() {
    super("ingestion-worker");
    const meter = getMeter("ingestion-worker");

    this.embeddingDurationMs = meter.createHistogram("ingestion.embedding.duration_ms", {
      description: "Time to produce an embedding vector",
      unit: "ms",
      advice: { explicitBucketBoundaries: [10, 25, 50, 100, 250, 500, 1000, 2500] },
    });

    this.opensearchWriteDurationMs = meter.createHistogram("ingestion.opensearch.write_duration_ms", {
      description: "Time to index a document in OpenSearch",
      unit: "ms",
      advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500] },
    });

    this.importanceScore = meter.createHistogram("ingestion.importance_score", {
      description: "Distribution of importance scores assigned to ingested events",
      unit: "1",
      advice: { explicitBucketBoundaries: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] },
    });
  }
}

/** Additional instruments for the consolidation worker. */
export class ConsolidationMetrics extends WorkerMetrics {
  readonly sourceEvents: Histogram;
  readonly consolidationDurationMs: Histogram;

  constructor() {
    super("consolidation-worker");
    const meter = getMeter("consolidation-worker");

    this.sourceEvents = meter.createHistogram("consolidation.source_events", {
      description: "Number of source events merged into a single semantic memory",
      unit: "{event}",
      advice: { explicitBucketBoundaries: [1, 2, 3, 5, 10, 20, 50] },
    });

    this.consolidationDurationMs = meter.createHistogram("consolidation.duration_ms", {
      description: "End-to-end consolidation latency per request",
      unit: "ms",
      advice: { explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2500, 5000] },
    });
  }
}

/** Additional instruments for the pattern worker. */
export class PatternMetrics extends WorkerMetrics {
  readonly patternMatches: Counter;
  readonly matchScore: Histogram;
  readonly windowSize: UpDownCounter;

  constructor() {
    super("pattern-worker");
    const meter = getMeter("pattern-worker");

    this.patternMatches = meter.createCounter("pattern.matches", {
      description: "Total number of operational pattern matches",
      unit: "{match}",
    });

    this.matchScore = meter.createHistogram("pattern.match_score", {
      description: "Match confidence score at time of pattern detection",
      unit: "1",
      advice: { explicitBucketBoundaries: [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0] },
    });

    this.windowSize = meter.createUpDownCounter("pattern.window_size", {
      description: "Current number of primitive events in the sliding detection window",
      unit: "{event}",
    });
  }
}

/** Additional instruments for the reinforcement worker. */
export class ReinforcementMetrics extends WorkerMetrics {
  readonly recommendationsTracked: Counter;
  readonly outcomesRecorded: Counter;
  readonly rewardScore: Histogram;

  constructor() {
    super("reinforcement-worker");
    const meter = getMeter("reinforcement-worker");

    this.recommendationsTracked = meter.createCounter("reinforcement.recommendations_tracked", {
      description: "Total recommendations received and tracked",
      unit: "{recommendation}",
    });

    this.outcomesRecorded = meter.createCounter("reinforcement.outcomes_recorded", {
      description: "Total outcome feedback events recorded",
      unit: "{outcome}",
    });

    this.rewardScore = meter.createHistogram("reinforcement.reward_score", {
      description: "Distribution of reward scores from policy evaluation outcomes",
      unit: "1",
      advice: { explicitBucketBoundaries: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] },
    });
  }
}

/** Additional instruments for the telemetry worker. */
export class TelemetryWorkerMetrics extends WorkerMetrics {
  readonly batchSize: Histogram;
  readonly clickhouseWriteDurationMs: Histogram;
  readonly primitiveEventsEmitted: Counter;

  constructor() {
    super("telemetry-worker");
    const meter = getMeter("telemetry-worker");

    this.batchSize = meter.createHistogram("telemetry.batch_size", {
      description: "Number of metric records flushed per ClickHouse batch",
      unit: "{record}",
      advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500] },
    });

    this.clickhouseWriteDurationMs = meter.createHistogram("telemetry.clickhouse.write_duration_ms", {
      description: "Time to bulk-insert a batch into ClickHouse",
      unit: "ms",
      advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000] },
    });

    this.primitiveEventsEmitted = meter.createCounter("telemetry.primitive_events_emitted", {
      description: "Total cognitive primitive events published to cognition.primitives",
      unit: "{event}",
    });
  }
}

/** Additional instruments for the aiven-collector worker. */
export class AivenCollectorMetrics extends WorkerMetrics {
  readonly prometheusWriteRequests: Counter;
  readonly prometheusMetricSamples: Counter;
  readonly metadataPublished: Counter;

  constructor() {
    super("aiven-collector-worker");
    const meter = getMeter("aiven-collector-worker");

    this.prometheusWriteRequests = meter.createCounter("collector.prometheus.write_requests", {
      description: "Total Prometheus remote_write POST requests received",
      unit: "{request}",
    });

    this.prometheusMetricSamples = meter.createCounter("collector.prometheus.metric_samples", {
      description: "Total metric samples received via Prometheus remote_write",
      unit: "{sample}",
    });

    this.metadataPublished = meter.createCounter("collector.metadata_published", {
      description: "Total service metadata snapshots published to Kafka",
      unit: "{message}",
    });
  }
}
