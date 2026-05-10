import type { RawMetricMessage } from "./messages.js";

export function normalizeAivenMetrics(input: {
  readonly serviceId: string;
  readonly serviceType: string;
  readonly environment: string;
  readonly payload: unknown;
  readonly observedAt: string;
  readonly source: "managed" | "application";
  readonly warn?: (message: string) => void;
}): readonly RawMetricMessage[] {
  const series = extractTimeSeries(input.payload);
  if (series.length > 0) {
    return series.map((point) => ({
      serviceId: input.serviceId,
      serviceType: input.serviceType,
      metricName: point.metricName,
      value: point.value,
      labels: { ...point.labels, source: input.source },
      timestamp: point.timestamp ?? input.observedAt,
      environment: input.environment,
    }));
  }

  input.warn?.(
    `normalizeAivenMetrics: no time-series structure found in ${input.source} payload for ` +
    `${input.serviceId} (${input.serviceType}); falling back to flattenNumericLeaves`,
  );

  return flattenNumericLeaves(input.payload).map((point) => ({
    serviceId: input.serviceId,
    serviceType: input.serviceType,
    metricName: point.path,
    value: point.value,
    labels: { source: input.source },
    timestamp: input.observedAt,
    environment: input.environment,
  }));
}

interface TimeSeriesPoint {
  readonly metricName: string;
  readonly value: number;
  readonly timestamp?: string;
  readonly labels: Record<string, string>;
}

function extractTimeSeries(payload: unknown): readonly TimeSeriesPoint[] {
  const result: TimeSeriesPoint[] = [];
  visit(payload, [], (node, path) => {
    if (!isRecord(node)) return;
    const metricName = stringValue(node["metric"]) ?? stringValue(node["metric_name"]) ?? path.at(-1);
    const data = node["data"] ?? node["values"] ?? node["points"];
    if (!metricName || !Array.isArray(data)) return;

    for (const point of data) {
      const parsed = parsePoint(point);
      if (!parsed) continue;
      result.push({
        metricName,
        value: parsed.value,
        labels: labelsFromRecord(node),
        ...(parsed.timestamp ? { timestamp: parsed.timestamp } : {}),
      });
    }
  });
  return result;
}

function parsePoint(point: unknown): { readonly value: number; readonly timestamp?: string } | undefined {
  if (Array.isArray(point) && point.length >= 2) {
    const timestamp = parseTimestamp(point[0]);
    const value = numberValue(point[1]);
    if (value !== undefined) return { value, ...(timestamp ? { timestamp } : {}) };
  }

  if (isRecord(point)) {
    const value =
      numberValue(point["value"]) ??
      numberValue(point["y"]) ??
      numberValue(point["metric_value"]);
    if (value === undefined) return undefined;
    const timestamp =
      parseTimestamp(point["time"]) ??
      parseTimestamp(point["timestamp"]) ??
      parseTimestamp(point["x"]);
    return { value, ...(timestamp ? { timestamp } : {}) };
  }

  return undefined;
}

function flattenNumericLeaves(payload: unknown): readonly { readonly path: string; readonly value: number }[] {
  const result: Array<{ path: string; value: number }> = [];
  visit(payload, [], (node, path) => {
    const value = numberValue(node);
    if (value === undefined || path.length === 0) return;
    result.push({ path: path.join("."), value });
  });
  return result;
}

function visit(
  node: unknown,
  path: readonly string[],
  visitor: (node: unknown, path: readonly string[]) => void,
): void {
  visitor(node, path);

  if (Array.isArray(node)) {
    node.forEach((value, index) => visit(value, [...path, String(index)], visitor));
    return;
  }

  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    visit(value, [...path, key], visitor);
  }
}

function labelsFromRecord(record: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {};
  const nestedLabels = record["labels"] ?? record["tags"];
  if (isRecord(nestedLabels)) {
    for (const [key, value] of Object.entries(nestedLabels)) {
      const string = stringValue(value);
      if (string !== undefined) labels[key] = string;
    }
  }

  for (const key of ["host", "component", "unit", "topic", "broker", "consumer_group"]) {
    const value = stringValue(record[key]);
    if (value !== undefined) labels[key] = value;
  }
  return labels;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
