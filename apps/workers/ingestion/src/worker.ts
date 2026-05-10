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
} from "@cognitive-substrate/kafka-bus";
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
  const openSearchClient = createOpenSearchClient(opensearchConfigFromEnv());
  const objectStore = createObjectStore();

  // Multi-profile mode: when EMBEDDING_LANES is set, build one embedder per
  // active profile and write separate vector fields per model family.
  const useLanes = process.env["EMBEDDING_LANES"] !== undefined;
  const profiledEmbedders = useLanes ? buildEmbeddersFromProfiles(embeddingProfilesFromEnv()) : undefined;

  // Legacy single-embedder path (used when EMBEDDING_LANES is not set).
  const embeddingConfig = openAIEmbeddingConfigFromEnv();
  const provider = process.env["EMBEDDING_PROVIDER"] ?? "openai";
  const legacyEmbedder = useLanes ? undefined
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

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: true });
  await producer.connect();

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "ingestion-workers",
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.EXPERIENCE_RAW}...`);

  await consumer.subscribe<ExperienceEvent>(
    [Topics.EXPERIENCE_RAW],
    async (message) => {
      const event = message.value;
      log(`Processing event ${event.eventId} (type=${event.type})`);

      const enriched = await processEvent(event, {
        ...(profiledEmbedders ? { profiledEmbedders } : { embedder: legacyEmbedder! }),
        openSearch: openSearchClient,
        objectStore,
        producer,
      });

      log(
        `Indexed event ${enriched.eventId} with importance=${enriched.importanceScore.toFixed(3)}`,
      );
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
