import type { OperationalPrimitiveId } from "./taxonomy.js";
import type { SystemMapping } from "./mapping-layer.js";

/**
 * A raw telemetry signal as it arrives on the telemetry.metrics.raw topic.
 * Vendor-specific names are preserved here; the normaliser converts them.
 */
export interface RawTelemetrySignal {
  /** The vendor/service identifier, e.g. "aiven.kafka.broker-1". */
  sourceSystem: string;
  /** Metric name as emitted by the service, e.g. "consumer_lag". */
  metricName: string;
  /** Current observed value. */
  value: number;
  /** Previous value (for trend computation). Undefined on first observation. */
  previousValue?: number;
  /** Baseline / expected value for this metric (used to compute relative intensity). */
  baseline?: number;
  /** Wall-clock timestamp of this observation. */
  timestamp: Date;
  /** Arbitrary key-value labels attached to this metric. */
  labels?: Record<string, string>;
}

/**
 * The system-agnostic primitive event emitted after normalisation.
 * All vendor-specific names are stripped; only behavioural dynamics remain.
 */
export interface OperationalPrimitiveEvent {
  /** Which primitive was detected. */
  primitiveId: OperationalPrimitiveId;
  /** Normalised signal strength in [0, 1].  1.0 = fully saturated. */
  intensity: number;
  /** Direction of change relative to the previous observation. */
  trend: "increasing" | "stable" | "decreasing";
  /** Whether the signal affects a single node or multiple nodes/partitions. */
  scope: "local" | "distributed";
  /** Confidence that the primitive classification is correct, in [0, 1]. */
  confidence: number;
  /** Opaque identifier of the originating system (no vendor labels). */
  sourceSystem: string;
  /** Broad category of the source system (e.g. "streaming", "search", "database"). */
  sourceSystemType: string;
  /** IDs of other signals that co-occurred and influenced this classification. */
  correlatedSignalIds: string[];
  /** Timestamp of the originating measurement. */
  timestamp: Date;
}

/**
 * Normalise a batch of raw telemetry signals into operational primitive events
 * using a provided system mapping.
 *
 * Signals that have no mapping entry are silently discarded so that the
 * downstream pattern worker only receives semantically meaningful events.
 */
export function normaliseSignals(
  signals: RawTelemetrySignal[],
  mapping: SystemMapping,
): OperationalPrimitiveEvent[] {
  const events: OperationalPrimitiveEvent[] = [];

  for (const signal of signals) {
    const primitiveId = resolvePrimitive(signal.metricName, mapping);
    if (!primitiveId) continue;

    events.push({
      primitiveId,
      intensity: computeIntensity(signal),
      trend: computeTrend(signal),
      scope: inferScope(signal),
      confidence: computeConfidence(signal, mapping),
      sourceSystem: signal.sourceSystem,
      sourceSystemType: mapping.systemType,
      correlatedSignalIds: [],
      timestamp: signal.timestamp,
    });
  }

  return events;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function resolvePrimitive(
  metricName: string,
  mapping: SystemMapping,
): OperationalPrimitiveId | undefined {
  // Exact match first
  if (metricName in mapping.metricMappings) {
    return mapping.metricMappings[metricName];
  }
  // Prefix / suffix wildcard match
  for (const [pattern, primitive] of Object.entries(mapping.metricMappings)) {
    if (pattern.endsWith("*") && metricName.startsWith(pattern.slice(0, -1))) {
      return primitive;
    }
  }
  return undefined;
}

function computeIntensity(signal: RawTelemetrySignal): number {
  if (signal.baseline !== undefined && signal.baseline > 0) {
    return Math.min(signal.value / signal.baseline, 1);
  }
  return 0.5;
}

function computeTrend(signal: RawTelemetrySignal): "increasing" | "stable" | "decreasing" {
  if (signal.previousValue === undefined) return "stable";
  const delta = signal.value - signal.previousValue;
  const threshold = signal.baseline ? signal.baseline * 0.02 : 1;
  if (delta > threshold) return "increasing";
  if (delta < -threshold) return "decreasing";
  return "stable";
}

function inferScope(signal: RawTelemetrySignal): "local" | "distributed" {
  const labels = signal.labels ?? {};
  // Heuristic: if the signal has partition, topic, shard, or node labels it is
  // likely a per-entity signal (local); without them it is cluster-level (distributed).
  const localIndicators = ["partition", "shard", "node", "broker", "replica"];
  const hasLocalLabel = localIndicators.some((k) => k in labels);
  return hasLocalLabel ? "local" : "distributed";
}

function computeConfidence(signal: RawTelemetrySignal, mapping: SystemMapping): number {
  // Exact metric name match → higher confidence than wildcard match.
  if (signal.metricName in mapping.metricMappings) {
    return 0.9;
  }
  return 0.65;
}
