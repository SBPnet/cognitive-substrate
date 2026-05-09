/**
 * One-shot script: create all Kafka topics from TOPIC_CONFIGS.
 * Safe to run repeatedly — uses createTopics with no throw on TOPIC_ALREADY_EXISTS.
 *
 * Usage:
 *   KAFKA_BROKERS=localhost:9092 pnpm tsx scripts/smoke/init-kafka-topics.ts
 *
 * For Aiven (SCRAM):
 *   KAFKA_BROKERS=<host>:<port> KAFKA_SSL=true KAFKA_SASL_MECHANISM=scram-sha-256 \
 *   KAFKA_SASL_USERNAME=cognitive-substrate-app KAFKA_SASL_PASSWORD=<pw> \
 *   pnpm tsx scripts/smoke/init-kafka-topics.ts
 */

import { Kafka, logLevel, type SASLOptions } from "kafkajs";
import { TOPIC_CONFIGS } from "../../packages/kafka-bus/src/topics.js";

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

const kafka = new Kafka({
  clientId: "smoke-topic-init",
  brokers,
  logLevel: logLevel.WARN,
  ...(ssl ? { ssl } : {}),
  ...(sasl ? { sasl } : {}),
  retry: { initialRetryTime: 300, retries: 10 },
});

const log = (msg: string) => process.stdout.write(`[topic-init] ${msg}\n`);

const admin = kafka.admin();

async function run() {
  await admin.connect();
  log(`Connected to ${brokers.join(", ")}`);

  const existing = await admin.listTopics();
  const missingConfigs = TOPIC_CONFIGS.filter((tc) => !existing.includes(tc.name));
  const topicDefs = missingConfigs.map((tc) => ({
    topic: tc.name,
    numPartitions: tc.partitions,
    // Force rf=1 for local single-broker; min(configured, 1)
    replicationFactor: 1,
    configEntries: [
      {
        name: "retention.ms",
        value: tc.retentionMs === -1 ? "-1" : String(tc.retentionMs),
      },
      { name: "cleanup.policy", value: "delete" },
    ],
  }));

  if (topicDefs.length > 0) {
    log(`Creating ${topicDefs.length} topics...`);
    await admin.createTopics({
      topics: topicDefs,
      waitForLeaders: true,
    });
    log("Topics created successfully.");
  } else {
    log("Topics already exist (no-op).");
  }

  // Verify
  const verified = topicDefs.length > 0 ? await admin.listTopics() : existing;
  const missing = TOPIC_CONFIGS.map((t) => t.name).filter((name) => !verified.includes(name));
  if (missing.length > 0) {
    log(`WARNING: missing topics after creation: ${missing.join(", ")}`);
  } else {
    log(`All ${TOPIC_CONFIGS.length} topics verified present.`);
  }

  await admin.disconnect();
}

run().catch((err: unknown) => {
  process.stderr.write(`[topic-init] Error: ${String(err)}\n`);
  process.exit(1);
});
