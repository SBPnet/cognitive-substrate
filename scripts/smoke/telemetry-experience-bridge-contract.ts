import { TelemetryExperienceBridge } from "../../apps/workers/telemetry/src/experience-bridge.js";
import { Topics } from "../../packages/kafka-bus/src/topics.js";
import type { CognitiveProducer } from "../../packages/kafka-bus/src/producer.js";

const published: Array<{ topic: string; value: unknown }> = [];
const producer = {
  publish: async (topic: string, value: unknown) => {
    published.push({ topic, value });
  },
} as unknown as CognitiveProducer;

const bridge = new TelemetryExperienceBridge({
  producer,
  windowMs: 1,
  costPerMillionTokensUsd: 0.15,
  environment: "contract",
});

bridge.observeMetric({
  serviceId: "cs-api-20260509",
  serviceType: "application",
  metricName: "requests_total",
  value: 100,
  timestamp: "2026-05-09T04:45:00.000Z",
  environment: "contract",
});
bridge.observeMetric({
  serviceId: "cs-aiven-collector-20260509",
  serviceType: "application",
  metricName: "records_published",
  value: 58000,
  timestamp: "2026-05-09T04:45:01.000Z",
  environment: "contract",
});
bridge.observeLog({
  serviceId: "cs-aiven-collector-20260509",
  serviceType: "application",
  message: "published telemetry batch",
  timestamp: "2026-05-09T04:45:02.000Z",
  environment: "contract",
});
bridge.observeMetadata({
  serviceId: "cs-aiven-collector-20260509",
  serviceType: "application",
  timestamp: "2026-05-09T04:45:03.000Z",
  environment: "contract",
});

const event = await bridge.flush();
if (!event) throw new Error("Expected telemetry bridge to publish an experience");
if (published.length !== 1 || published[0]?.topic !== Topics.EXPERIENCE_RAW) {
  throw new Error("Telemetry bridge did not publish exactly one experience.raw event");
}
if (event.type !== "environmental_observation") {
  throw new Error(`Unexpected event type ${event.type}`);
}
if (!event.tags.includes("aiven_telemetry") || !event.tags.includes("operational_summary")) {
  throw new Error("Telemetry bridge event is missing required tags");
}
const structured = event.input.structured as Record<string, unknown>;
if (structured["busiestServiceId"] !== "cs-aiven-collector-20260509") {
  throw new Error("Telemetry bridge did not identify the busiest service");
}
if (typeof structured["estimatedTokens"] !== "number") {
  throw new Error("Telemetry bridge did not estimate token usage");
}
if (typeof structured["estimatedEmbeddingCostUsd"] !== "number") {
  throw new Error("Telemetry bridge did not estimate embedding cost");
}

process.stdout.write("[telemetry-experience-bridge-contract] Experience bridge contract passed\n");
