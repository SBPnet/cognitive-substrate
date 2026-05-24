/**
 * Ingestion worker: subscribes to `experience.raw` and runs each message
 * through the ingestion pipeline.
 *
 * This module wires together the Kafka consumer, embedding client,
 * OpenSearch client, object store, and producer.
 *
 * Multi-profile mode: when EMBEDDING_LANES is set, one embedder is built
 * per active profile (quality, efficient, hybrid) and the pipeline writes
 * a separate vector field per model family into OpenSearch.
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  ensureKafkaTopics,
  kafkaConfigFromEnv,
  schemaRegistryConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
  embeddingProfilesFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  EpisodicObjectStore,
  objectStoreConfigFromEnv,
} from "@cognitive-substrate/memory-objectstore";
import {
  initTelemetry,
  telemetryConfigFromEnv,
  IngestionMetrics,
} from "@cognitive-substrate/telemetry-otel";

import {
  OpenAIEmbeddingClient,
  StubEmbeddingClient,
  VertexEmbeddingClient,
  buildEmbeddersFromProfiles,
  openAIEmbeddingConfigFromEnv,
  vertexEmbeddingConfigFromEnv,
} from "./embedder.js";
import { processEvent } from "./pipeline.js";

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("ingestion-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[ingestion-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafkaConfig = kafkaConfigFromEnv();
  log("Ensuring Kafka topics exist...");
  await ensureKafkaTopics(kafkaConfig);

  const kafka = createKafkaClient(kafkaConfig);
  const schemaRegistryConfig = schemaRegistryConfigFromEnv();
  const openSearchClient = createOpenSearchClient(opensearchConfigFromEnv());
  const objectStore = createObjectStore();

  // Multi-profile mode: when EMBEDDING_LANES is set, build one embedder per
  // active profile and write separate vector fields per model family.
  const useLanes = process.env["EMBEDDING_LANES"] !== undefined;
  const profiledEmbedders = useLanes ? buildEmbeddersFromProfiles(embeddingProfilesFromEnv()) : undefined;

  // When INGEST_PIPELINE is set, OpenSearch ML handles embedding at index time.
  // The worker skips client-side embedding entirely in this mode.
  const ingestPipeline = process.env["INGEST_PIPELINE"] ?? undefined;

  // Legacy single-embedder path (used when EMBEDDING_LANES is not set and no ingest pipeline).
  const embeddingConfig = openAIEmbeddingConfigFromEnv();
  const provider = process.env["EMBEDDING_PROVIDER"] ?? "openai";
  const legacyEmbedder = (useLanes || ingestPipeline) ? undefined
    : provider === "stub"
      ? new StubEmbeddingClient(embeddingConfig.dimension)
      : provider === "vertex"
        ? new VertexEmbeddingClient(vertexEmbeddingConfigFromEnv())
        : new OpenAIEmbeddingClient(embeddingConfig);

  if (useLanes) {
    log(`Embedding profiles active: ${profiledEmbedders!.map((p) => `${p.profile.lane}(${p.profile.id})`).join(", ")}`);
  } else {
    log(`Embedding provider: ${provider}`);
  }

  log("Ensuring OpenSearch indexes exist...");
  await ensureIndexes(openSearchClient);

  const workerMetrics = new IngestionMetrics();

  const producer = new CognitiveProducer({
    kafka,
    enableAuditMirror: true,
    ...(schemaRegistryConfig ? { schemaRegistry: schemaRegistryConfig } : {}),
  });
  await producer.connect();

  // Register schemas once at startup when Schema Registry is configured.
  // schemaId is undefined when SCHEMA_REGISTRY_URL is absent (JSON fallback).
  const schemasDir = join(fileURLToPath(import.meta.url), "../../../../packages/kafka-bus/schemas");
  let experienceRawSchemaId: number | undefined;
  let experienceEnrichedSchemaId: number | undefined;
  let memoryIndexedSchemaId: number | undefined;
  if (schemaRegistryConfig) {
    const loadSchema = (filename: string): object =>
      JSON.parse(readFileSync(join(schemasDir, filename), "utf-8")) as object;
    experienceRawSchemaId = await producer.registerSchema(
      "experience.raw-value",
      loadSchema("experience.raw.v1.avsc"),
    );
    experienceEnrichedSchemaId = await producer.registerSchema(
      "experience.enriched-value",
      loadSchema("experience.enriched.v1.avsc"),
    );
    memoryIndexedSchemaId = await producer.registerSchema(
      "memory.indexed-value",
      loadSchema("memory.indexed.v1.avsc"),
    );
    log(
      `Schema Registry: experience.raw=${experienceRawSchemaId} enriched=${experienceEnrichedSchemaId} indexed=${memoryIndexedSchemaId}`,
    );
  }

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "ingestion-workers",
    ...(schemaRegistryConfig ? { schemaRegistry: schemaRegistryConfig } : {}),
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.EXPERIENCE_RAW}...`);

  await consumer.subscribe<ExperienceEvent>(
    [Topics.EXPERIENCE_RAW],
    async (message) => {
      const event = message.value;
      const attrs = { "event.type": event.type };
      const done = workerMetrics.startMessage(attrs);
      log(`Processing event ${event.eventId} (type=${event.type})`);

      try {
        const enriched = await processEvent(event, {
          ...(ingestPipeline
            ? { ingestPipeline }
            : profiledEmbedders
              ? { profiledEmbedders }
              : { embedder: legacyEmbedder! }),
          openSearch: openSearchClient,
          objectStore,
          producer,
          onEmbeddingDuration: (ms) => workerMetrics.embeddingDurationMs.record(ms, attrs),
          onWriteDuration: (ms) => workerMetrics.opensearchWriteDurationMs.record(ms, attrs),
          ...(experienceEnrichedSchemaId !== undefined ? { experienceEnrichedSchemaId } : {}),
          ...(memoryIndexedSchemaId !== undefined ? { memoryIndexedSchemaId } : {}),
        });

        workerMetrics.importanceScore.record(enriched.importanceScore, attrs);
        done();
        log(
          `Indexed event ${enriched.eventId} with importance=${enriched.importanceScore.toFixed(3)}`,
        );
      } catch (err) {
        done(err);
        throw err;
      }
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

  log("Worker started. Waiting for messages...");
}

function createObjectStore(): Pick<EpisodicObjectStore, "put"> {
  if (process.env["OBJECT_STORE_PROVIDER"] === "noop") {
    return { put: async () => undefined };
  }
  return new EpisodicObjectStore(objectStoreConfigFromEnv());
}
