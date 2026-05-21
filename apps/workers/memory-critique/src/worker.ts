import { randomUUID } from "node:crypto";
import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
  updateDocument,
} from "@cognitive-substrate/memory-opensearch";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import type { MemoryCritiqueEvent, ExperienceEvent } from "@cognitive-substrate/core-types";
import { applyCritiqueAndCascade } from "./cascade.js";

/** Trust delta applied per confidence tier. */
const TRUST_DELTA_HIGH = -0.25;   // confidenceScore >= 0.8
const TRUST_DELTA_MID = -0.12;    // confidenceScore >= 0.5
// Low confidence (< 0.5) only logs; no write.

/** Suppression threshold raise applied to the critiqued memory. */
const SUPPRESSION_THRESHOLD_RAISE = 0.08;

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(telemetryConfigFromEnv("memory-critique-worker"));

  const log = (msg: string): void => {
    process.stdout.write(`[memory-critique-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafkaConfig = kafkaConfigFromEnv();
  const kafka = createKafkaClient(kafkaConfig);
  const openSearch = createOpenSearchClient(opensearchConfigFromEnv());

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "memory-critique-workers",
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.MEMORY_FEEDBACK}...`);

  await consumer.subscribe<MemoryCritiqueEvent>(
    [Topics.MEMORY_FEEDBACK],
    async (message) => {
      const critique = message.value;
      if (!critique?.critiqueId) {
        log("Skipping malformed MCE");
        return;
      }

      log(`Processing critique ${critique.critiqueId} type=${critique.critiqueType} confidence=${critique.confidenceScore}`);

      // Low-confidence critiques are logged only — no writes.
      if (critique.confidenceScore < 0.5) {
        log(`Low-confidence critique ${critique.critiqueId} — skipping writes`);
        return;
      }

      const trustDelta = critique.confidenceScore >= 0.8 ? TRUST_DELTA_HIGH : TRUST_DELTA_MID;

      // 1. Apply trust delta + cascade through abstraction ladder.
      const { updated } = await applyCritiqueAndCascade(openSearch, critique, trustDelta);
      log(`Trust delta ${trustDelta} applied to ${updated} memories`);

      // 2. Raise suppression threshold on the primary memory so similar
      //    future retrievals are filtered out sooner.
      if (critique.memoryId) {
        await updateDocument(openSearch, "memory_semantic", critique.memoryId, {
          suppression_threshold: SUPPRESSION_THRESHOLD_RAISE,
          last_critique_at: new Date().toISOString(),
        });
      }

      // 3. Inject a competing memory when a high-confidence replacement is provided.
      if (critique.confidenceScore >= 0.8 && critique.suggestedReplacement) {
        await injectReplacementMemory(producer, critique);
        log(`Injected replacement memory for critique ${critique.critiqueId}`);
      }

      // 4. Trigger early re-consolidation of the affected memory cluster.
      await triggerReconsolidation(producer, critique);
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await consumer.disconnect();
    await producer.disconnect();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Memory Critique Worker started. Waiting for critique events...");
}

/**
 * Publish a new ExperienceEvent containing the suggested replacement so
 * the ingest pipeline embeds and indexes it as a competing memory at the
 * same abstraction level.
 */
async function injectReplacementMemory(
  producer: CognitiveProducer,
  critique: MemoryCritiqueEvent,
): Promise<void> {
  const replacement: ExperienceEvent = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "consolidation_output",
    context: {
      sessionId: critique.sessionId,
      agentId: "memory-critique-worker",
    },
    input: {
      text: critique.suggestedReplacement ?? "",
      embedding: [],
    },
    importanceScore: 0.75,
    tags: [
      "source:memory-critique",
      `critique:${critique.critiqueId}`,
      `replaces:${critique.memoryId ?? "unknown"}`,
      ...(critique.abstractionLevel ? [`level:${critique.abstractionLevel}`] : []),
    ],
  };

  await producer.publish(Topics.EXPERIENCE_RAW, replacement, {
    key: critique.sessionId,
  });
}

/**
 * Publish a consolidation request scoped to the critiqued memory's cluster
 * so the consolidation worker re-processes it ahead of schedule.
 */
async function triggerReconsolidation(
  producer: CognitiveProducer,
  critique: MemoryCritiqueEvent,
): Promise<void> {
  const request = {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    reason: "memory_critique",
    targetMemoryId: critique.memoryId,
    targetClusterCentroid: critique.clusterCentroid,
    priority: critique.confidenceScore >= 0.8 ? "high" : "normal",
  };

  await producer.publish(Topics.CONSOLIDATION_REQUEST, request, {
    key: critique.sessionId,
  });
}
