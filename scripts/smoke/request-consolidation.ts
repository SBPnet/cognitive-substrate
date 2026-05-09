/**
 * One-shot smoke script: publish a ConsolidationRequest to the consolidation.request topic.
 *
 * The consolidation worker listens for this message and consolidates recent experience
 * events from OpenSearch into semantic memories, populating memory_semantic and
 * making /api/sessions/:id/memories/search return results.
 *
 * Usage:
 *   KAFKA_BROKERS=localhost:9092 pnpm tsx scripts/smoke/request-consolidation.ts
 *
 * Options (via environment):
 *   MAX_AGE_HOURS   — experience window in hours (default: 24)
 *   BATCH_SIZE      — max events to consolidate (default: 20)
 *   MIN_IMPORTANCE  — minimum importance score filter (default: 0.1)
 */

import { randomUUID } from "crypto";
import {
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "../../packages/kafka-bus/src/index.js";
import type { ConsolidationRequest } from "../../packages/consolidation-engine/src/types.js";

const log = (msg: string) =>
  process.stdout.write(`[request-consolidation] ${msg}\n`);

process.env["KAFKAJS_NO_PARTITIONER_WARNING"] ??= "1";

async function run(): Promise<void> {
  const kafka = createKafkaClient(kafkaConfigFromEnv());
  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });

  await producer.connect();
  log("Connected to Kafka.");

  const maxAgeHours = Number(process.env["MAX_AGE_HOURS"] ?? "24");
  const size = Number(process.env["BATCH_SIZE"] ?? "20");
  const minImportance = Number(process.env["MIN_IMPORTANCE"] ?? "0.1");

  const maxAge = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

  const request: ConsolidationRequest = {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    maxAge,
    size,
    minImportance,
  };

  log(
    `Publishing consolidation request ${request.requestId} ` +
      `(window: last ${maxAgeHours}h, size: ${size}, minImportance: ${minImportance})`,
  );

  await producer.publish(Topics.CONSOLIDATION_REQUEST, request, {
    key: request.requestId,
  });

  log("Consolidation request published. Disconnecting...");
  await producer.disconnect();
  log("Done.");
}

run().catch((err: unknown) => {
  process.stderr.write(`[request-consolidation] Error: ${String(err)}\n`);
  process.exit(1);
});
