/**
 * Core ingestion pipeline logic.
 *
 * Responsibilities (in order):
 *   1. Receive a raw ExperienceEvent from the Kafka consumer.
 *   2. Generate embeddings (one per active profile, or legacy single).
 *   3. Compute an initial importance score.
 *   4. Write the full payload to the object-storage truth layer (write-once).
 *   5. Index metadata + embeddings in OpenSearch `experience_events`.
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

import type { EmbeddingClient, ProfiledEmbeddingClient } from "./embedder.js";
import { scoreImportance } from "./scorer.js";

const tracer = getTracer("ingestion-worker");

export type OpenSearchClient = ReturnType<typeof createOpenSearchClient>;

export interface PipelineConfig {
  /**
   * Primary single embedder (legacy / backward-compat path).
   * Ignored when profiledEmbedders is also provided.
   */
  readonly embedder?: EmbeddingClient;
  /**
   * One client per active embedding profile.  When present, the pipeline
   * writes a separate vector field per profile and records embedding_meta.
   * The first profile in the array is treated as primary and also written
   * to the legacy "embedding" field so older queries still work.
   */
  readonly profiledEmbedders?: ReadonlyArray<ProfiledEmbeddingClient>;
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
      // Step 1: Generate embeddings (multi-profile or legacy single).
      const { primaryEmbedding, profileVectors } = await withSpan(
        tracer,
        "experience.embed",
        { [CogAttributes.EVENT_ID]: rawEvent.eventId },
        async () => {
          if (config.profiledEmbedders && config.profiledEmbedders.length > 0) {
            return embedAllProfiles(rawEvent.input.text, config.profiledEmbedders, span);
          }
          if (config.embedder) {
            const vec = await config.embedder.embed(rawEvent.input.text);
            span.setAttribute(CogAttributes.EMBEDDING_DIM, vec.length);
            return { primaryEmbedding: vec, profileVectors: {} };
          }
          throw new Error("PipelineConfig requires either embedder or profiledEmbedders");
        },
      );
      const embedding = primaryEmbedding;

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

      // Step 6: Index metadata + embeddings in OpenSearch.
      await withSpan(
        tracer,
        "experience.opensearch.index",
        {
          [CogAttributes.EVENT_ID]: rawEvent.eventId,
          [CogAttributes.MEMORY_INDEX]: "experience_events",
        },
        async () => {
          const primaryProfile = config.profiledEmbedders?.[0]?.profile;
          await indexDocument(config.openSearch, "experience_events", rawEvent.eventId, {
            event_id: rawEvent.eventId,
            timestamp: rawEvent.timestamp,
            event_type: rawEvent.type,
            session_id: rawEvent.context.sessionId,
            user_id: rawEvent.context.userId,
            agent_id: rawEvent.context.agentId,
            summary: rawEvent.input.text.slice(0, 1000),
            // Legacy field: primary profile vector (or single embedder vector).
            embedding,
            // Per-profile vectors for model comparison.
            ...profileVectors,
            // Provenance metadata recorded per document.
            ...(primaryProfile ? {
              embedding_meta: {
                profile_id: primaryProfile.id,
                model_name: primaryProfile.name,
                dimension:  primaryProfile.dimension,
                lane:       primaryProfile.lane,
                indexed_at: new Date().toISOString(),
              },
            } : {}),
            structured: rawEvent.input.structured ?? {},
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface EmbedAllResult {
  primaryEmbedding: ReadonlyArray<number>;
  profileVectors: Record<string, ReadonlyArray<number>>;
}

async function embedAllProfiles(
  text: string,
  profiledEmbedders: ReadonlyArray<ProfiledEmbeddingClient>,
  span: { setAttribute(key: string, value: string | number | boolean): void },
): Promise<EmbedAllResult> {
  const profileVectors: Record<string, ReadonlyArray<number>> = {};
  let primaryEmbedding: ReadonlyArray<number> | undefined;

  for (const { profile, client } of profiledEmbedders) {
    try {
      const vec = await client.embed(text);
      profileVectors[profile.vectorField] = vec;
      if (!primaryEmbedding) {
        primaryEmbedding = vec;
        span.setAttribute(CogAttributes.EMBEDDING_DIM, vec.length);
      }
    } catch (err: unknown) {
      process.stderr.write(
        `[pipeline] embed failed for profile ${profile.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  if (!primaryEmbedding) {
    throw new Error("All embedding profiles failed — cannot index document without at least one vector.");
  }

  return { primaryEmbedding, profileVectors };
}
