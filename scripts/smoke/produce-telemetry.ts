/**
 * Synthetic telemetry producer — drives the telemetry pipeline without a
 * real Aiven service integration.
 *
 * Produces N messages to telemetry.metrics.raw at a configurable rate,
 * then exits. Useful for verifying the telemetry -> pattern -> reinforcement
 * worker chain locally.
 *
 * Usage:
 *   KAFKA_BROKERS=localhost:9092 pnpm tsx scripts/smoke/produce-telemetry.ts
 *   COUNT=20 INTERVAL_MS=500 pnpm tsx scripts/smoke/produce-telemetry.ts
 */

import { Kafka, Partitioners, logLevel, type SASLOptions } from "kafkajs";

const brokers = (process.env["KAFKA_BROKERS"] ?? "localhost:9092")
  .split(",")
  .map((b) => b.trim());
const ssl = process.env["KAFKA_SSL"] === "true";
const mechanism = process.env["KAFKA_SASL_MECHANISM"] as
  | "scram-sha-256"
  | "scram-sha-512"
  | "plain"
  | undefined;
let sasl: SASLOptions | undefined;
if (mechanism) {
  sasl = {
    mechanism,
    username: process.env["KAFKA_SASL_USERNAME"] ?? "",
    password: process.env["KAFKA_SASL_PASSWORD"] ?? "",
  };
}

const COUNT = parseInt(process.env["COUNT"] ?? "10", 10);
const INTERVAL_MS = parseInt(process.env["INTERVAL_MS"] ?? "200", 10);
const ENVIRONMENT = process.env["ENVIRONMENT"] ?? "dev";

const kafka = new Kafka({
  clientId: "smoke-telemetry-producer",
  brokers,
  logLevel: logLevel.WARN,
  ...(ssl ? { ssl } : {}),
  ...(sasl ? { sasl } : {}),
});

const log = (msg: string) =>
  process.stdout.write(`[telemetry-producer] ${msg}\n`);

const METRICS_TOPIC = "telemetry.metrics.raw";
const LOGS_TOPIC = "telemetry.logs.raw";
const METADATA_TOPIC = "telemetry.metadata.raw";

const SAMPLE_METRICS = [
  { metricName: "consumer_lag", serviceType: "kafka", baseline: 25 },
  { metricName: "search_query_latency_ms_99th", serviceType: "opensearch", baseline: 100 },
  { metricName: "query_duration_ms_99th", serviceType: "clickhouse", baseline: 100 },
  { metricName: "connection_count", serviceType: "pg", baseline: 50 },
];

async function run() {
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  await producer.connect();
  log(`Connected. Producing ${COUNT} messages to ${METRICS_TOPIC} at ${INTERVAL_MS}ms intervals.`);

  for (let i = 0; i < COUNT; i++) {
    const sample = SAMPLE_METRICS[i % SAMPLE_METRICS.length];
    const payload = {
      timestamp: new Date().toISOString(),
      serviceId: `smoke-${sample!.serviceType}-01`,
      serviceType: sample!.serviceType,
      metricName: sample!.metricName,
      value: Math.random() * 100,
      previousValue: Math.random() * 50,
      baseline: sample!.baseline,
      labels: { environment: ENVIRONMENT, region: "local" },
      environment: ENVIRONMENT,
    };

    await producer.send({
      topic: METRICS_TOPIC,
      messages: [{ value: JSON.stringify(payload) }],
    });
    log(`[${i + 1}/${COUNT}] Sent metric: ${sample!.metricName} = ${payload.value.toFixed(2)}`);

    if (i < COUNT - 1) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  await producer.send({
    topic: LOGS_TOPIC,
    messages: [
      {
        value: JSON.stringify({
          project: "smoke-project",
          serviceId: "smoke-kafka-01",
          serviceType: "kafka",
          unit: "broker-1",
          message: "warning: consumer lag breached smoke threshold",
          timestamp: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          environment: ENVIRONMENT,
        }),
      },
    ],
  });
  log(`Sent one structured log to ${LOGS_TOPIC}`);

  await producer.send({
    topic: METADATA_TOPIC,
    messages: [
      {
        value: JSON.stringify({
          project: "smoke-project",
          serviceId: "smoke-kafka-01",
          serviceType: "kafka",
          source: "aiven.collector",
          snapshot: { state: "RUNNING", plan: "smoke" },
          timestamp: new Date().toISOString(),
          environment: ENVIRONMENT,
        }),
      },
    ],
  });
  log(`Sent one metadata snapshot to ${METADATA_TOPIC}`);

  await producer.disconnect();
  log("Done.");
}

run().catch((err: unknown) => {
  process.stderr.write(`[telemetry-producer] Error: ${String(err)}\n`);
  process.exit(1);
});
