import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import { Topics } from "@cognitive-substrate/kafka-bus";
import {
  BUILTIN_MAPPINGS,
  normaliseSignals,
  type RawTelemetrySignal,
  type SystemMapping,
} from "@cognitive-substrate/abstraction-engine";
import {
  type ClickHouseTelemetryClient,
  TelemetryInserter,
  type MetricsRawRow,
  type CognitiveEventRow,
} from "@cognitive-substrate/clickhouse-telemetry";

/**
 * A raw metric message as it arrives on the telemetry.metrics.raw topic.
 * Producers (OTEL collectors, Aiven integration connectors) write this shape.
 */
export interface RawMetricMessage {
  serviceId: string;
  serviceType: string;
  metricName: string;
  value: number;
  previousValue?: number;
  baseline?: number;
  labels?: Record<string, string>;
  timestamp: string;
  environment: string;
}

/**
 * A normalised telemetry event published to TELEMETRY_EVENTS_NORMALIZED.
 * Carries the original metric fields augmented with the operational-primitive
 * IDs that were resolved for the source system.
 */
export interface NormalizedTelemetryEvent {
  readonly serviceId: string;
  readonly serviceType: string;
  readonly metricName: string;
  readonly value: number;
  readonly resolvedPrimitives: readonly string[];
  readonly timestamp: string;
  readonly environment: string;
}

/**
 * A cognitive-primitive signal event published to COGNITION_PRIMITIVES.
 * Each event is system-agnostic and carries intensity, trend, confidence,
 * and correlation metadata.
 */
export interface CognitivePrimitiveEvent {
  readonly primitiveId: string;
  readonly intensity: number;
  readonly trend: string;
  readonly scope: string;
  readonly confidence: number;
  readonly sourceSystem: string;
  readonly sourceSystemType: string;
  readonly correlatedSignalIds: readonly string[];
  readonly timestamp: string;
}

export interface TelemetryPipelineConfig {
  producer: CognitiveProducer;
  clickhouse: ClickHouseTelemetryClient;
  /** Additional mappings to merge with the built-in set. */
  extraMappings?: ReadonlyMap<string, SystemMapping>;
}

/**
 * Process a batch of raw metric messages:
 *   1. Write raw rows to ClickHouse (metrics_raw).
 *   2. Normalise to operational primitives using the system mapping.
 *   3. Write cognitive event rows to ClickHouse (cognitive_events).
 *   4. Emit telemetry.events.normalized and cognition.primitives to Kafka.
 */
export async function processTelemetryBatch(
  messages: RawMetricMessage[],
  config: TelemetryPipelineConfig,
): Promise<void> {
  const { producer, clickhouse, extraMappings } = config;
  const inserter = new TelemetryInserter(clickhouse);

  const mappings: ReadonlyMap<string, SystemMapping> = extraMappings
    ? new Map([...BUILTIN_MAPPINGS, ...extraMappings])
    : BUILTIN_MAPPINGS;

  // 1. Write raw rows
  const rawRows: MetricsRawRow[] = messages.map((m) => ({
    timestamp: new Date(m.timestamp),
    service_id: m.serviceId,
    service_type: m.serviceType,
    metric_name: m.metricName,
    value: m.value,
    labels: m.labels ?? {},
    environment: m.environment,
  }));
  await inserter.insertMetrics(rawRows);

  // 2. Normalise per source system
  const grouped = groupBySystem(messages);
  const cognitiveRows: CognitiveEventRow[] = [];
  const primitiveEvents: CognitivePrimitiveEvent[] = [];
  const normalizedEvents: NormalizedTelemetryEvent[] = [];

  for (const [systemId, systemMessages] of Object.entries(grouped)) {
    const mapping = resolveMapping(systemId, mappings);
    if (!mapping) continue;

    const signals: RawTelemetrySignal[] = systemMessages.map((m) => ({
      sourceSystem: m.serviceId,
      metricName: m.metricName,
      value: m.value,
      ...(m.previousValue !== undefined ? { previousValue: m.previousValue } : {}),
      ...(m.baseline !== undefined ? { baseline: m.baseline } : {}),
      timestamp: new Date(m.timestamp),
      ...(m.labels !== undefined ? { labels: m.labels } : {}),
    }));

    const primitives = normaliseSignals(signals, mapping);

    for (const p of primitives) {
      cognitiveRows.push({
        timestamp: p.timestamp,
        primitive_id: p.primitiveId,
        intensity: p.intensity,
        trend: p.trend,
        scope: p.scope,
        confidence: p.confidence,
        source_system: p.sourceSystem,
        source_system_type: p.sourceSystemType,
        correlated_signal_ids: p.correlatedSignalIds,
        pattern_match_id: null,
        environment: systemMessages[0]?.environment ?? "prod",
      });

      primitiveEvents.push({
        primitiveId: p.primitiveId,
        intensity: p.intensity,
        trend: p.trend,
        scope: p.scope,
        confidence: p.confidence,
        sourceSystem: p.sourceSystem,
        sourceSystemType: p.sourceSystemType,
        correlatedSignalIds: p.correlatedSignalIds,
        timestamp: p.timestamp.toISOString(),
      });
    }

    if (primitives.length > 0) {
      normalizedEvents.push(
        ...systemMessages.map((m) => ({
          serviceId: m.serviceId,
          serviceType: m.serviceType,
          metricName: m.metricName,
          value: m.value,
          resolvedPrimitives: primitives
            .filter((p) => p.sourceSystem === m.serviceId)
            .map((p) => p.primitiveId),
          timestamp: m.timestamp,
          environment: m.environment,
        })),
      );
    }
  }

  // 3. Write cognitive events to ClickHouse
  if (cognitiveRows.length > 0) {
    await inserter.insertCognitiveEvents(cognitiveRows);
  }

  // 4. Publish to Kafka
  if (normalizedEvents.length > 0) {
    await producer.publish(Topics.TELEMETRY_EVENTS_NORMALIZED, normalizedEvents);
  }
  await Promise.all(
    primitiveEvents.map((event) => producer.publish(Topics.COGNITION_PRIMITIVES, event)),
  );
}

function groupBySystem(messages: RawMetricMessage[]): Record<string, RawMetricMessage[]> {
  const result: Record<string, RawMetricMessage[]> = {};
  for (const m of messages) {
    const key = inferSystemId(m.serviceId, m.serviceType);
    (result[key] ??= []).push(m);
  }
  return result;
}

function inferSystemId(serviceId: string, serviceType: string): string {
  if (serviceType === "kafka") return "aiven.kafka";
  if (serviceType === "opensearch") return "aiven.opensearch";
  if (serviceType === "pg" || serviceType === "postgres") return "aiven.postgres";
  if (serviceType === "clickhouse") return "aiven.clickhouse";
  return `aiven.${serviceType}`;
}

function resolveMapping(
  systemId: string,
  mappings: ReadonlyMap<string, SystemMapping>,
): SystemMapping | undefined {
  if (mappings.has(systemId)) return mappings.get(systemId);
  // Try prefix match: "aiven.kafka.broker-1" → "aiven.kafka"
  for (const [key, mapping] of mappings) {
    if (systemId.startsWith(key)) return mapping;
  }
  return undefined;
}
