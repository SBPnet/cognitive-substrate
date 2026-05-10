import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import { Topics, type CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { RawMetricMessage } from "./pipeline.js";

export interface RawLogMessage {
  readonly serviceId: string;
  readonly serviceType: string;
  readonly message: string;
  readonly timestamp: string;
  readonly environment: string;
}

export interface RawMetadataMessage {
  readonly serviceId?: string;
  readonly serviceType?: string;
  readonly timestamp: string;
  readonly environment: string;
}

export interface TelemetryExperienceBridgeConfig {
  readonly producer: CognitiveProducer;
  readonly windowMs: number;
  readonly costPerMillionTokensUsd: number;
  readonly environment: string;
}

interface ServiceWindow {
  serviceType: string;
  metricRecords: number;
  logRecords: number;
  metadataRecords: number;
  metricNames: Set<string>;
  firstTimestamp: string;
  lastTimestamp: string;
}

export class TelemetryExperienceBridge {
  private readonly producer: CognitiveProducer;
  private readonly windowMs: number;
  private readonly costPerMillionTokensUsd: number;
  private readonly environment: string;
  private readonly services = new Map<string, ServiceWindow>();
  private windowStartedAt = new Date();

  constructor(config: TelemetryExperienceBridgeConfig) {
    this.producer = config.producer;
    this.windowMs = config.windowMs;
    this.costPerMillionTokensUsd = config.costPerMillionTokensUsd;
    this.environment = config.environment;
  }

  observeMetric(metric: RawMetricMessage): void {
    const service = this.serviceWindow(metric.serviceId, metric.serviceType, metric.timestamp);
    service.metricRecords += 1;
    service.metricNames.add(metric.metricName);
    service.lastTimestamp = maxTimestamp(service.lastTimestamp, metric.timestamp);
  }

  observeLog(log: RawLogMessage): void {
    const service = this.serviceWindow(log.serviceId, log.serviceType, log.timestamp);
    service.logRecords += 1;
    service.lastTimestamp = maxTimestamp(service.lastTimestamp, log.timestamp);
  }

  observeMetadata(metadata: RawMetadataMessage): void {
    const serviceId = metadata.serviceId ?? "aiven-project";
    const serviceType = metadata.serviceType ?? "project";
    const service = this.serviceWindow(serviceId, serviceType, metadata.timestamp);
    service.metadataRecords += 1;
    service.lastTimestamp = maxTimestamp(service.lastTimestamp, metadata.timestamp);
  }

  shouldFlush(now = Date.now()): boolean {
    return now - this.windowStartedAt.getTime() >= this.windowMs;
  }

  async flush(): Promise<ExperienceEvent | undefined> {
    if (this.services.size === 0) {
      this.windowStartedAt = new Date();
      return undefined;
    }

    const ranked = [...this.services.entries()]
      .map(([serviceId, service]) => ({
        serviceId,
        serviceType: service.serviceType,
        metricRecords: service.metricRecords,
        logRecords: service.logRecords,
        metadataRecords: service.metadataRecords,
        totalRecords: service.metricRecords + service.logRecords + service.metadataRecords,
        metricNames: [...service.metricNames].sort().slice(0, 10),
      }))
      .sort((left, right) => right.totalRecords - left.totalRecords);

    const busiest = ranked[0]!;
    const windowStart = this.windowStartedAt.toISOString();
    const windowEnd = new Date().toISOString();
    const baseSummary = [
      `Aiven telemetry summary for ${windowStart} to ${windowEnd}.`,
      `${busiest.serviceId} was the busiest observed service with ${busiest.totalRecords} telemetry records: ${busiest.metricRecords} metrics, ${busiest.logRecords} logs, and ${busiest.metadataRecords} metadata updates.`,
      `Top services by telemetry volume: ${ranked
        .slice(0, 5)
        .map((service) => `${service.serviceId} (${service.totalRecords})`)
        .join(", ")}.`,
      `Primary metric names observed for the busiest service: ${busiest.metricNames.join(", ") || "none"}.`,
    ].join(" ");
    const estimatedTokens = estimateTokens(baseSummary);
    const estimatedEmbeddingCostUsd =
      (estimatedTokens / 1_000_000) * this.costPerMillionTokensUsd;
    const summary = `${baseSummary} Estimated Vertex embedding input is ${estimatedTokens} tokens at approximately $${estimatedEmbeddingCostUsd.toFixed(8)}.`;

    const event: ExperienceEvent = {
      eventId: randomUUID(),
      timestamp: windowEnd,
      type: "environmental_observation",
      context: {
        sessionId: "telemetry:aiven",
        traceId: randomUUID(),
        agentId: "telemetry-worker",
      },
      input: {
        text: summary,
        embedding: [],
        structured: {
          source: "telemetry-worker",
          environment: this.environment,
          windowStart,
          windowEnd,
          busiestServiceId: busiest.serviceId,
          rankedServices: ranked,
          estimatedTokens,
          estimatedEmbeddingCostUsd,
        },
      },
      importanceScore: 0.8,
      tags: [
        "aiven_telemetry",
        "operational_summary",
        "busiest_service",
        `service:${busiest.serviceId}`,
        `service_type:${busiest.serviceType}`,
      ],
    };

    await this.producer.publish(Topics.EXPERIENCE_RAW, event, {
      key: event.eventId,
    });

    this.services.clear();
    this.windowStartedAt = new Date();
    return event;
  }

  private serviceWindow(
    serviceId: string,
    serviceType: string,
    timestamp: string,
  ): ServiceWindow {
    const existing = this.services.get(serviceId);
    if (existing) return existing;
    const next: ServiceWindow = {
      serviceType,
      metricRecords: 0,
      logRecords: 0,
      metadataRecords: 0,
      metricNames: new Set(),
      firstTimestamp: timestamp,
      lastTimestamp: timestamp,
    };
    this.services.set(serviceId, next);
    return next;
  }
}

export function telemetryExperienceBridgeFromEnv(
  producer: CognitiveProducer,
): TelemetryExperienceBridge | undefined {
  if (process.env["TELEMETRY_EXPERIENCE_ENABLED"] !== "true") return undefined;
  return new TelemetryExperienceBridge({
    producer,
    windowMs: Number(process.env["TELEMETRY_EXPERIENCE_WINDOW_MS"] ?? "60000"),
    costPerMillionTokensUsd: Number(
      process.env["VERTEX_EMBED_COST_PER_MILLION_TOKENS_USD"] ?? "0.15",
    ),
    environment: process.env["ENVIRONMENT"] ?? "unknown",
  });
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function maxTimestamp(left: string, right: string): string {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}
