/**
 * Core ingestion pipeline logic.
 *
 * Responsibilities (in order):
 *   1. Receive a raw ExperienceEvent from the Kafka consumer.
 *   2. Generate an embedding for the event text.
 *   3. Compute an initial importance score.
 *   4. Write the full payload to the object-storage truth layer (write-once).
 *   5. Index metadata + embedding in OpenSearch `experience_events`.
 *   6. Emit an enriched event to `experience.enriched`.
 *   7. Emit a confirmation to `memory.indexed`.
 *
 * All steps execute within a root OTel span so the full pipeline is traceable.
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import { Topics } from "@cognitive-substrate/kafka-bus";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import {
  indexDocument as openSearchIndexDocument,
  createOpenSearchClient,
} from "@cognitive-substrate/memory-opensearch";
import {
  EpisodicObjectStore,
  eventKey,
} from "@cognitive-substrate/memory-objectstore";
import {
  CogAttributes,
  withSpan,
  getTracer,
} from "@cognitive-substrate/telemetry-otel";

import type { EmbeddingClient } from "./embedder.js";
import { scoreImportance } from "./scorer.js";

const tracer = getTracer("ingestion-worker");

export type OpenSearchClient = ReturnType<typeof createOpenSearchClient>;

export interface PipelineConfig {
  readonly embedder: EmbeddingClient;
  readonly openSearch: OpenSearchClient;
  readonly objectStore: Pick<EpisodicObjectStore, "put">;
  readonly producer: CognitiveProducer;
  readonly indexDocument?: typeof openSearchIndexDocument;
}

/** Enriched event payload emitted to `experience.enriched`. */
export interface EnrichedEventPayload {
  readonly eventId: string;
  readonly timestamp: string;
  readonly importanceScore: number;
  readonly embeddingDimension: number;
  readonly objectStorageKey: string;
  readonly tags: ReadonlyArray<string>;
}

/** Indexed confirmation payload emitted to `memory.indexed`. */
export interface MemoryIndexedPayload {
  readonly eventId: string;
  readonly timestamp: string;
  readonly index: "experience_events";
  readonly objectStorageKey: string;
}

/**
 * Processes a single raw ExperienceEvent through the full ingestion pipeline.
 * Returns the enriched event payload that was emitted.
 */
export async function processEvent(
  rawEvent: ExperienceEvent,
  config: PipelineConfig,
): Promise<EnrichedEventPayload> {
  const indexDocument = config.indexDocument ?? openSearchIndexDocument;

  return withSpan(
    tracer,
    "experience.ingest",
    {
      [CogAttributes.EVENT_ID]: rawEvent.eventId,
      [CogAttributes.EVENT_TYPE]: rawEvent.type,
      [CogAttributes.SESSION_ID]: rawEvent.context.sessionId,
    },
    async (span) => {
      // Step 1: Generate embedding.
      const embedding = await withSpan(
        tracer,
        "experience.embed",
        { [CogAttributes.EVENT_ID]: rawEvent.eventId },
        async () => {
          const vec = await config.embedder.embed(rawEvent.input.text);
          span.setAttribute(CogAttributes.EMBEDDING_DIM, vec.length);
          return vec;
        },
      );

      // Step 2: Compute importance score.
      const importanceScore = scoreImportance({ ...rawEvent });
      span.setAttribute(CogAttributes.IMPORTANCE_SCORE, importanceScore);

      // Step 3: Determine object storage key.
      const objectStorageKey = eventKey(rawEvent.eventId, rawEvent.timestamp);

      // Step 4: Build the enriched event (full payload written to object store).
      const enrichedEvent: ExperienceEvent = {
        ...rawEvent,
        input: { ...rawEvent.input, embedding },
        importanceScore,
        objectStorageKey,
      };

      // Step 5: Write to object storage (write-once, immutable).
      await withSpan(
        tracer,
        "experience.objectstore.put",
        { [CogAttributes.EVENT_ID]: rawEvent.eventId },
        async () => {
          await config.objectStore.put(objectStorageKey, enrichedEvent);
        },
      );

      // Step 6: Index metadata + embedding in OpenSearch.
      await withSpan(
        tracer,
        "experience.opensearch.index",
        {
          [CogAttributes.EVENT_ID]: rawEvent.eventId,
          [CogAttributes.MEMORY_INDEX]: "experience_events",
        },
        async () => {
          await indexDocument(config.openSearch, "experience_events", rawEvent.eventId, {
            event_id: rawEvent.eventId,
            timestamp: rawEvent.timestamp,
            event_type: rawEvent.type,
            session_id: rawEvent.context.sessionId,
            user_id: rawEvent.context.userId,
            agent_id: rawEvent.context.agentId,
            summary: rawEvent.input.text.slice(0, 1000),
            embedding,
            importance_score: importanceScore,
            reward_score: rawEvent.evaluation?.rewardScore ?? 0.5,
            confidence: rawEvent.internalState?.confidence ?? 0.5,
            retrieval_count: 0,
            decay_factor: 1.0,
            object_storage_key: objectStorageKey,
            tags: rawEvent.tags,
          });
        },
      );

      const enrichedPayload: EnrichedEventPayload = {
        eventId: rawEvent.eventId,
        timestamp: rawEvent.timestamp,
        importanceScore,
        embeddingDimension: embedding.length,
        objectStorageKey,
        tags: rawEvent.tags,
      };

      // Step 7: Emit to `experience.enriched`.
      const traceContextForPublish = rawEvent.context.traceId
        ? {
            version: "00" as const,
            traceId: rawEvent.context.traceId,
            parentId: rawEvent.context.spanId ?? "0000000000000000",
            traceFlags: "01" as const,
          }
        : undefined;
      await config.producer.publish(
        Topics.EXPERIENCE_ENRICHED,
        enrichedPayload,
        traceContextForPublish
          ? { key: rawEvent.eventId, traceContext: traceContextForPublish }
          : { key: rawEvent.eventId },
      );

      // Step 8: Emit to `memory.indexed`.
      const indexedPayload: MemoryIndexedPayload = {
        eventId: rawEvent.eventId,
        timestamp: rawEvent.timestamp,
        index: "experience_events",
        objectStorageKey,
      };
      await config.producer.publish(Topics.MEMORY_INDEXED, indexedPayload, {
        key: rawEvent.eventId,
      });

      span.setAttribute(CogAttributes.MEMORY_INDEX, "experience_events");
      return enrichedPayload;
    },
  );
}
