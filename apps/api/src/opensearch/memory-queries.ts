/**
 * OpenSearch query helpers for the BFF memory endpoints.
 */

import type { Client } from "@opensearch-project/opensearch";
import {
  RETRIEVAL_MODE_VECTOR_FIELD,
  search,
  type RetrievalMode,
} from "@cognitive-substrate/memory-opensearch";
import type { ConversationTurnDto, MemoryDto } from "../types.js";

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
  // Return consolidated semantic memories -- the same index the LLM retrieves
  // from during a cognitive loop turn. Filtered to memories that have been
  // accessed in this session via the session_tags field written by the
  // reinforcement engine, falling back to top-importance memories globally.
  const sessionTag = `session:${sessionId}`;
  const sessionQuery = {
    query: {
      bool: {
        should: [
          { term: { tags: sessionTag } },
          { term: { "tags.keyword": sessionTag } },
        ],
        minimum_should_match: 1,
      },
    },
    sort: [{ importance_score: { order: "desc" } }, { last_retrieved: { order: "desc" } }],
    size: limit,
    _source: {
      includes: ["memory_id", "summary", "generalization", "importance_score", "last_retrieved", "tags"],
      excludes: Object.values(RETRIEVAL_MODE_VECTOR_FIELD),
    },
  };

  const hits = await search<SemanticHit>(client, "memory_semantic", sessionQuery);

  return hits.map((h): MemoryDto => {
    const base: MemoryDto = {
      memoryId: h._source.memory_id ?? h._id,
      index: "memory_semantic",
      summary: h._source.summary ?? h._source.generalization ?? "",
      importanceScore: h._source.importance_score ?? 0,
      score: h._score,
    };
    const lastRetrieved = h._source.last_retrieved;
    return lastRetrieved !== undefined ? { ...base, lastRetrieved } : base;
  });
}

export async function searchSemanticMemories(
  client: Client,
  queryText: string,
  limit = 10,
  retrievalMode: RetrievalMode = "legacy",
  sessionId?: string,
): Promise<MemoryDto[]> {
  const selectedVectorField = RETRIEVAL_MODE_VECTOR_FIELD[retrievalMode];
  const textClause = {
    multi_match: {
      query: queryText,
      fields: ["summary^2", "generalization"],
    },
  };
  const semanticQuery = {
    query: sessionId
      ? {
          bool: {
            must: textClause,
            filter: {
              bool: {
                should: [
                  { term: { tags: `session:${sessionId}` } },
                  { term: { "tags.keyword": `session:${sessionId}` } },
                ],
                minimum_should_match: 1,
              },
            },
          },
        }
      : textClause,
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

interface AuditHit extends Record<string, unknown> {
  readonly originalTopic?: string;
  readonly timestamp?: string;
  readonly payload?: Record<string, unknown>;
}

export async function getConversationTurns(
  client: Client,
  sessionId: string,
  limit = 200,
): Promise<ConversationTurnDto[]> {
  const query = {
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                { term: { "payload.sessionId": sessionId } },
                { term: { "payload.context.sessionId": sessionId } },
              ],
              minimum_should_match: 1,
            },
          },
          {
            terms: {
              originalTopic: ["experience.raw", "interaction.response"],
            },
          },
        ],
      },
    },
    sort: [{ timestamp: { order: "asc" } }],
    size: limit,
    _source: ["originalTopic", "timestamp", "payload"],
  };

  try {
    const hits = await search<AuditHit>(client, "audit_events" as never, query);
    const turns: ConversationTurnDto[] = [];

    for (const h of hits) {
      const src = h._source;
      const topic = src.originalTopic ?? "";
      const payload = src.payload ?? {};
      const ts = src.timestamp ?? new Date().toISOString();

      if (topic === "experience.raw") {
        const type = payload["type"] as string | undefined;
        if (type !== "user_input") continue;
        const input = payload["input"] as Record<string, unknown> | undefined;
        const text = typeof input?.["text"] === "string" ? input["text"] : "";
        if (!text) continue;
        const userEventId = payload["eventId"] as string | undefined;
        const userTurn: ConversationTurnDto = {
          id: `user-${userEventId ?? ts}`,
          role: "user",
          text,
          timestamp: ts,
          status: "complete",
          ...(userEventId !== undefined ? { eventId: userEventId } : {}),
        };
        turns.push(userTurn);
      } else if (topic === "interaction.response") {
        const status = payload["status"] as string | undefined;
        const responseText = typeof payload["responseText"] === "string" ? payload["responseText"] : "";
        if (!responseText) continue;
        const eventId = payload["eventId"] as string | undefined;
        const confidence = typeof payload["confidence"] === "number" ? payload["confidence"] : undefined;
        const riskScore = typeof payload["riskScore"] === "number" ? payload["riskScore"] : undefined;
        const assistantTurn: ConversationTurnDto = {
          id: `assistant-${eventId ?? ts}`,
          role: "assistant",
          text: responseText,
          timestamp: ts,
          status: status === "failed" ? "failed" : "complete",
          ...(confidence !== undefined ? { confidence } : {}),
          ...(riskScore !== undefined ? { riskScore } : {}),
          ...(eventId !== undefined ? { eventId } : {}),
        };
        turns.push(assistantTurn);
      }
    }

    return turns;
  } catch {
    return [];
  }
}
