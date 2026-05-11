/**
 * Repeatable smoke helper: post representative experiences through the API,
 * optionally trigger consolidation, then report OpenSearch index counts.
 *
 * Creates a single session, submits five representative experience messages,
 * waits for ingestion, and optionally publishes a ConsolidationRequest.
 * Exits with counts for experience_events and memory_semantic indexes.
 *
 * Usage:
 *   API_URL=http://localhost:3001 \
 *   KAFKA_BROKERS=localhost:9092 \
 *   OPENSEARCH_URL=http://localhost:9200 \
 *   pnpm tsx scripts/smoke/feed-experiences.ts
 *
 * Options (via environment):
 *   CONSOLIDATE     — set to "true" to also trigger consolidation (default: true)
 *   WAIT_SECONDS    — seconds to wait after feed before querying counts (default: 5)
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
  process.stdout.write(`[feed-experiences] ${msg}\n`);
const err = (msg: string) =>
  process.stderr.write(`[feed-experiences] ERROR: ${msg}\n`);

const API_URL = process.env["API_URL"] ?? "http://localhost:3001";
const OPENSEARCH_URL = process.env["OPENSEARCH_URL"] ?? "http://localhost:9200";
const CONSOLIDATE = process.env["CONSOLIDATE"] !== "false";
const WAIT_SECONDS = Number(process.env["WAIT_SECONDS"] ?? "5");
const INGESTION_WAIT_SECONDS = Number(process.env["INGESTION_WAIT_SECONDS"] ?? "20");
const MIN_EPISODIC_COUNT = Number(process.env["MIN_EPISODIC_COUNT"] ?? "1");
const MIN_SEMANTIC_COUNT = Number(process.env["MIN_SEMANTIC_COUNT"] ?? "1");

process.env["KAFKAJS_NO_PARTITIONER_WARNING"] ??= "1";

const SAMPLE_EXPERIENCES = [
  {
    text: "Ingestion pipeline processed 1,200 events in 3 seconds with p99 latency of 42 ms.",
    tags: ["ingestion", "latency", "performance"],
  },
  {
    text: "Policy engine updated reward weights after detecting sustained BACKPRESSURE_ACCUMULATION signal.",
    tags: ["policy", "reinforcement", "backpressure"],
  },
  {
    text: "Consolidation run produced 8 semantic memories from 47 episodic events across the last 6 hours.",
    tags: ["consolidation", "memory", "semantic"],
  },
  {
    text: "OpenSearch knn index reported 99.7% recall at k=10 during retrieval benchmark.",
    tags: ["opensearch", "retrieval", "benchmark"],
  },
  {
    text: "Pattern detector identified LATENCY_SPIKE correlated with Kafka consumer lag exceeding 500 ms.",
    tags: ["pattern", "latency", "kafka"],
  },
];

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable body)");
    throw new Error(`POST ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function getIndexCount(index: string): Promise<number> {
  try {
    const res = await fetch(`${OPENSEARCH_URL}/${index}/_count`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return -1;
    const body = (await res.json()) as { count?: number };
    return body.count ?? -1;
  } catch {
    return -1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  // Create session
  const { sessionId } = await apiPost<{ sessionId: string }>(
    "/api/sessions",
    {},
  );
  log(`Created session ${sessionId}`);

  // Post experiences
  for (const exp of SAMPLE_EXPERIENCES) {
    const result = await apiPost<{ eventId: string; status: string }>(
      `/api/sessions/${sessionId}/messages`,
      exp,
    );
    log(`Posted eventId=${result.eventId} status=${result.status}: ${exp.text.slice(0, 60)}…`);
  }
  log(`${SAMPLE_EXPERIENCES.length} experiences queued.`);

  // Trigger consolidation
  if (CONSOLIDATE) {
    await waitForIndexCount("experience_events", MIN_EPISODIC_COUNT, INGESTION_WAIT_SECONDS);

    const kafka = createKafkaClient(kafkaConfigFromEnv());
    const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
    await producer.connect();

    const maxAge = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const request: ConsolidationRequest = {
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
      maxAge,
      size: 20,
      minImportance: 0.1,
    };
    await producer.publish(Topics.CONSOLIDATION_REQUEST, request, {
      key: request.requestId,
    });
    log(`Consolidation request ${request.requestId} published.`);
    await producer.disconnect();
  }

  // Wait for async pipeline
  log(`Waiting ${WAIT_SECONDS}s for pipeline to process…`);
  await sleep(WAIT_SECONDS * 1000);

  // Report index counts
  const episodicCount = await getIndexCount("experience_events");
  const semanticCount = await getIndexCount("memory_semantic");

  log("--- Index counts ---");
  log(`experience_events : ${episodicCount === -1 ? "index not found" : episodicCount}`);
  log(`memory_semantic   : ${semanticCount === -1 ? "index not found" : semanticCount}`);
  log("--------------------");

  const failures: string[] = [];

  if (episodicCount < MIN_EPISODIC_COUNT) {
    failures.push(
      `experience_events count ${episodicCount} is below minimum ${MIN_EPISODIC_COUNT}.`,
    );
  }
  if (CONSOLIDATE && semanticCount < MIN_SEMANTIC_COUNT) {
    failures.push(
      `memory_semantic count ${semanticCount} is below minimum ${MIN_SEMANTIC_COUNT}.`,
    );
  }

  log(`Session: ${sessionId}`);
  log(`  GET /api/sessions/${sessionId}/memories`);
  log(`  GET /api/sessions/${sessionId}/memories/search?q=latency%20ingestion%20policy`);
  log(`  GET /api/sessions/${sessionId}/memories/trace`);

  if (failures.length > 0) {
    for (const failure of failures) {
      err(failure);
    }
    process.exit(1);
  }
}

async function waitForIndexCount(
  index: string,
  minimum: number,
  timeoutSeconds: number,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await getIndexCount(index);
    if (count >= minimum) return;
    await sleep(1_000);
  }
  throw new Error(`${index} count ${count} stayed below minimum ${minimum}`);
}

run().catch((e: unknown) => {
  err(String(e));
  process.exit(1);
});
