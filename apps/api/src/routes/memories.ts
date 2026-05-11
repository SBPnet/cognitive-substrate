/**
 * Memory context routes.
 *
 * GET /api/sessions/:sessionId/memories        — episodic memories for the session
 * GET /api/sessions/:sessionId/memories/search — semantic search across all indexes
 * GET /api/sessions/:sessionId/trace           — recent audit/trace events
 */

import { Hono } from "hono";
import type { Client } from "@opensearch-project/opensearch";
import type { RetrievalMode } from "@cognitive-substrate/memory-opensearch";
import type { MemoriesResponse, TraceEventDto } from "../types.js";
import {
  getSessionMemories,
  searchSemanticMemories,
  getRecentAuditEvents,
} from "../opensearch/memory-queries.js";

export function createMemoriesRouter(openSearchClient: Client): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
    const limit = Math.max(1, Number(c.req.query("limit") ?? "20"));

    const memories = await getSessionMemories(openSearchClient, sessionId, limit);
    const response: MemoriesResponse = { memories, total: memories.length };
    return c.json(response);
  });

  router.get("/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const limit = Math.max(1, Number(c.req.query("limit") ?? "10"));
    const retrievalMode = parseRetrievalMode(c.req.query("mode"));

    if (!q.trim()) {
      return c.json({ memories: [], total: 0 } as MemoriesResponse);
    }

    const memories = await searchSemanticMemories(openSearchClient, q, limit, retrievalMode);
    const response: MemoriesResponse = { memories, total: memories.length };
    return c.json(response);
  });

  router.get("/trace", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
    const limit = Math.max(1, Number(c.req.query("limit") ?? "50"));

    const raw = await getRecentAuditEvents(openSearchClient, sessionId, limit);

    const events: TraceEventDto[] = raw.map((r, i) => {
      const payload = isRecord(r["payload"]) ? r["payload"] : {};
      const originalTopic = typeof r["originalTopic"] === "string" ? r["originalTopic"] : "";
      return {
        eventId: typeof payload["eventId"] === "string" ? payload["eventId"] : String(i),
        sessionId,
        timestamp:
          typeof r["timestamp"] === "string" ? r["timestamp"] : new Date().toISOString(),
        stage: stageForTopic(originalTopic),
        detail: `${originalTopic}: ${summarizePayload(payload)}`,
      };
    });

    return c.json({ events, total: events.length });
  });

  return router;
}

function parseRetrievalMode(value: string | undefined): RetrievalMode {
  if (value === "quality" || value === "efficient" || value === "hybrid" || value === "legacy") {
    return value;
  }
  return "legacy";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stageForTopic(topic: string): TraceEventDto["stage"] {
  if (topic === "experience.raw") return "received";
  if (topic === "experience.enriched") return "embedding";
  if (topic === "memory.indexed") return "indexed";
  if (topic === "interaction.response") return "complete";
  return "complete";
}

function summarizePayload(payload: Record<string, unknown>): string {
  const text = isRecord(payload["input"]) && typeof payload["input"]["text"] === "string"
    ? payload["input"]["text"]
    : typeof payload["responseText"] === "string"
      ? payload["responseText"]
      : JSON.stringify(payload);
  return text.slice(0, 180);
}
