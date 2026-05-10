import { Topics, TOPIC_CONFIGS } from "../../packages/kafka-bus/src/topics.js";
import { normalizeAivenMetrics } from "../../apps/workers/aiven-collector/src/metrics.js";

const requiredTopics = [
  Topics.TELEMETRY_METRICS_RAW,
  Topics.TELEMETRY_LOGS_RAW,
  Topics.TELEMETRY_METADATA_RAW,
] as const;

for (const topic of requiredTopics) {
  if (!TOPIC_CONFIGS.some((config) => config.name === topic)) {
    throw new Error(`Missing Kafka topic config for ${topic}`);
  }
}

const normalized = normalizeAivenMetrics({
  serviceId: "cs-aiven-kafka-20260509",
  serviceType: "kafka",
  environment: "smoke",
  source: "managed",
  observedAt: "2026-05-09T00:00:00.000Z",
  payload: {
    metrics: [
      {
        metric: "kafka_server_BrokerTopicMetrics_MessagesInPerSec_Count",
        labels: { topic: "telemetry.metrics.raw" },
        values: [["2026-05-09T00:00:00.000Z", 42]],
      },
    ],
  },
});

if (normalized.length !== 1) {
  throw new Error(`Expected one normalized metric, got ${normalized.length}`);
}

const [metric] = normalized;
if (!metric || metric.metricName !== "kafka_server_BrokerTopicMetrics_MessagesInPerSec_Count") {
  throw new Error("Collector metric normalization did not preserve metric name");
}

if (metric.value !== 42 || metric.labels?.["topic"] !== "telemetry.metrics.raw") {
  throw new Error("Collector metric normalization did not preserve value and labels");
}

process.stdout.write("[aiven-collector-contract] Collector topic and metric contracts passed\n");
