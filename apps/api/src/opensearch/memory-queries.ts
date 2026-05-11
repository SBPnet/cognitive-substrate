/**
 * OpenSearch query helpers for the BFF memory endpoints.
 */

import type { Client } from "@opensearch-project/opensearch";
import {
  RETRIEVAL_MODE_VECTOR_FIELD,
  search,
  type RetrievalMode,
} from "@cognitive-substrate/memory-opensearch";
import type { MemoryDto } from "../types.js";

interface ExperienceHit extends Record<string, unknown> {
  readonly event_id?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly summary?: string | undefined;
  readonly importance_score?: number | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
}

interface SemanticHit extends Record<string, unknown> {
  readonly memory_id?: string | undefined;
  readonly created_at?: string | undefined;
  readonly summary?: string | undefined;
  readonly generalization?: string | undefined;
  readonly importance_score?: number | undefined;
  readonly last_retrieved?: string | undefined;
}

export async function getSessionMemories(
  client: Client,
  sessionId: string,
  limit = 20,
): Promise<MemoryDto[]> {
  const experienceQuery = {
    query: { term: { session_id: sessionId } },
    sort: [{ importance_score: { order: "desc" } }, { timestamp: { order: "desc" } }],
    size: limit,
    _source: ["event_id", "timestamp", "summary", "importance_score", "tags"],
  };

  const hits = await search<ExperienceHit>(client, "experience_events", experienceQuery);

  return hits.map((h): MemoryDto => {
    const base: MemoryDto = {
      memoryId: h._source.event_id ?? h._id,
      index: "experience_events",
      summary: h._source.summary ?? "",
      importanceScore: h._source.importance_score ?? 0,
      score: h._score,
    };
    const tags = h._source.tags;
    if (tags !== undefined && tags.length > 0) {
      return { ...base, tags };
    }
    return base;
  });
}

export async function searchSemanticMemories(
  client: Client,
  queryText: string,
  limit = 10,
  retrievalMode: RetrievalMode = "legacy",
): Promise<MemoryDto[]> {
  const selectedVectorField = RETRIEVAL_MODE_VECTOR_FIELD[retrievalMode];
  const semanticQuery = {
    query: {
      multi_match: {
        query: queryText,
        fields: ["summary^2", "generalization"],
      },
    },
    sort: [{ importance_score: { order: "desc" } }],
    size: limit,
    _source: {
      includes: ["memory_id", "summary", "generalization", "importance_score", "last_retrieved"],
      excludes: [selectedVectorField, ...Object.values(RETRIEVAL_MODE_VECTOR_FIELD)],
    },
  };

  const hits = await search<SemanticHit>(client, "memory_semantic", semanticQuery);

  return hits.map((h): MemoryDto => {
    const base: MemoryDto = {
      memoryId: h._source.memory_id ?? h._id,
      index: "memory_semantic",
      summary: h._source.summary ?? h._source.generalization ?? "",
      importanceScore: h._source.importance_score ?? 0,
      score: h._score,
    };
    const lastRetrieved = h._source.last_retrieved;
    if (lastRetrieved !== undefined) {
      return { ...base, lastRetrieved };
    }
    return base;
  });
}

export async function getRecentAuditEvents(
  client: Client,
  sessionId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const query = {
    query: {
      bool: {
        should: [
          { term: { "payload.sessionId": sessionId } },
          { term: { "payload.context.sessionId": sessionId } },
          { term: { "payload.sessionId.keyword": sessionId } },
          { term: { "payload.context.sessionId.keyword": sessionId } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ timestamp: { order: "desc" } }],
    size: limit,
  };

  try {
    const hits = await search<Record<string, unknown>>(client, "audit_events" as never, query);
    return hits.map((h) => h._source);
  } catch {
    return [];
  }
}
