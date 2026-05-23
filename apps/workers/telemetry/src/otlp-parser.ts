/**
 * Parses OTLP-JSON ExportMetricsServiceRequest batches emitted by the
 * internal OTEL Collector (telemetry.metrics.otlp topic) into the flat
 * RawMetricMessage shape consumed by processTelemetryBatch.
 *
 * The collector's kafkaexporter serialises one OTLP batch per Kafka message
 * using the protobuf-JSON encoding (camelCase field names):
 *
 *   { resourceMetrics: [ { resource: { attributes: [...] }, scopeMetrics: [
 *     { metrics: [ { name, gauge|sum|histogram, ... } ] }
 *   ] } ] }
 *
 * For each data point we produce one RawMetricMessage. Histograms are
 * represented as their sum divided by count (mean), which gives the telemetry
 * pipeline a single scalar to normalise against operational primitives.
 * The original bucket data is discarded at this stage.
 */

import type { RawMetricMessage } from "./pipeline.js";

// ---------- Minimal OTLP-JSON type stubs ----------

interface OtlpKeyValue {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
}

interface OtlpNumberDataPoint {
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  asDouble?: number;
  asInt?: string;
  attributes?: OtlpKeyValue[];
}

interface OtlpHistogramDataPoint {
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  count?: string;
  sum?: number;
  attributes?: OtlpKeyValue[];
}

interface OtlpGauge {
  dataPoints: OtlpNumberDataPoint[];
}

interface OtlpSum {
  dataPoints: OtlpNumberDataPoint[];
}

interface OtlpHistogram {
  dataPoints: OtlpHistogramDataPoint[];
}

interface OtlpMetric {
  name: string;
  gauge?: OtlpGauge;
  sum?: OtlpSum;
  histogram?: OtlpHistogram;
}

interface OtlpScopeMetrics {
  metrics?: OtlpMetric[];
}

interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics?: OtlpScopeMetrics[];
}

interface OtlpExportMetricsServiceRequest {
  resourceMetrics?: OtlpResourceMetrics[];
}

// ---------- Parser ----------

function attrMap(attrs: OtlpKeyValue[] | undefined): Record<string, string> {
  if (!attrs) return {};
  const out: Record<string, string> = {};
  for (const kv of attrs) {
    const v = kv.value;
    const str =
      v.stringValue ??
      (v.intValue !== undefined ? v.intValue : undefined) ??
      (v.doubleValue !== undefined ? String(v.doubleValue) : undefined) ??
      (v.boolValue !== undefined ? String(v.boolValue) : undefined) ??
      "";
    out[kv.key] = str;
  }
  return out;
}

function nanoToIso(nanoStr: string | undefined): string {
  if (!nanoStr) return new Date().toISOString();
  const ms = Number(BigInt(nanoStr) / 1_000_000n);
  return new Date(ms).toISOString();
}

/**
 * Convert a parsed OTLP batch into flat RawMetricMessage rows.
 * Returns an empty array if the payload is not a valid OTLP batch.
 */
export function parseOtlpMetricBatch(
  payload: unknown,
  fallbackEnvironment: string,
): RawMetricMessage[] {
  if (typeof payload !== "object" || payload === null) return [];
  const batch = payload as OtlpExportMetricsServiceRequest;
  if (!Array.isArray(batch.resourceMetrics)) return [];

  const results: RawMetricMessage[] = [];

  for (const rm of batch.resourceMetrics) {
    const resourceAttrs = attrMap(rm.resource?.attributes);
    const serviceId = resourceAttrs["service.name"] ?? "unknown";
    const serviceType = `substrate.${serviceId}`;
    const environment = resourceAttrs["deployment.environment"] ?? fallbackEnvironment;

    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const metricName = metric.name;

        if (metric.gauge) {
          for (const dp of metric.gauge.dataPoints) {
            const value = dp.asDouble ?? Number(dp.asInt ?? "0");
            const labels = attrMap(dp.attributes);
            results.push({
              serviceId,
              serviceType,
              metricName,
              value,
              labels,
              timestamp: nanoToIso(dp.timeUnixNano),
              environment,
            });
          }
        } else if (metric.sum) {
          for (const dp of metric.sum.dataPoints) {
            const value = dp.asDouble ?? Number(dp.asInt ?? "0");
            const labels = attrMap(dp.attributes);
            results.push({
              serviceId,
              serviceType,
              metricName,
              value,
              labels,
              timestamp: nanoToIso(dp.timeUnixNano),
              environment,
            });
          }
        } else if (metric.histogram) {
          for (const dp of metric.histogram.dataPoints) {
            const count = Number(dp.count ?? "0");
            if (count === 0) continue;
            const mean = (dp.sum ?? 0) / count;
            const labels = attrMap(dp.attributes);
            results.push({
              serviceId,
              serviceType,
              metricName,
              value: mean,
              labels,
              timestamp: nanoToIso(dp.timeUnixNano),
              environment,
            });
          }
        }
      }
    }
  }

  return results;
}
