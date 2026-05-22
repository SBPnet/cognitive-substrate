/**
 * OpenTelemetry SDK bootstrap for cognitive-substrate services.
 *
 * Call `initTelemetry()` once at application startup — before any other imports
 * that use the OTel API — to register the tracer provider, metrics provider,
 * and OTLP exporters.
 *
 * Configuration is read from environment variables following the OTel standard:
 *   OTEL_SERVICE_NAME            — service name (required)
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTLP HTTP endpoint (e.g. http://collector:4318)
 *   OTEL_SDK_DISABLED            — "true" to disable all telemetry (e.g. in unit tests)
 *   OTEL_METRICS_INTERVAL_MS     — metric export interval, default 30000
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

let _sdk: NodeSDK | undefined;

export interface TelemetryConfig {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly otlpEndpoint?: string;
  readonly disabled?: boolean;
  readonly metricsIntervalMs?: number;
}

export function telemetryConfigFromEnv(defaultServiceName: string): TelemetryConfig {
  const base = {
    serviceName: process.env["OTEL_SERVICE_NAME"] ?? defaultServiceName,
    serviceVersion: process.env["npm_package_version"] ?? "0.0.0",
    disabled: process.env["OTEL_SDK_DISABLED"] === "true",
    metricsIntervalMs: process.env["OTEL_METRICS_INTERVAL_MS"]
      ? Number(process.env["OTEL_METRICS_INTERVAL_MS"])
      : 30_000,
  };
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  return endpoint ? { ...base, otlpEndpoint: endpoint } : base;
}

export async function initTelemetry(config: TelemetryConfig): Promise<() => Promise<void>> {
  if (config.disabled) {
    return async () => undefined;
  }

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion ?? "0.0.0",
  });

  const traceExporter = config.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${config.otlpEndpoint}/v1/traces` })
    : new OTLPTraceExporter();

  const metricExporter = config.otlpEndpoint
    ? new OTLPMetricExporter({ url: `${config.otlpEndpoint}/v1/metrics` })
    : new OTLPMetricExporter();

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: config.metricsIntervalMs ?? 30_000,
  });

  _sdk = new NodeSDK({ resource, traceExporter, metricReader });
  _sdk.start();

  return async () => {
    await _sdk?.shutdown();
  };
}
