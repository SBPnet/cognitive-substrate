/**
 * Session management routes.
 *
 * POST  /api/sessions       — create a new session
 * GET   /api/sessions       — list recent sessions (newest first)
 * GET   /api/sessions/:id   — fetch session metadata
 * PATCH /api/sessions/:id   — update session name or status
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import type { Client } from "@opensearch-project/opensearch";
import {
  indexDocument,
  updateDocument,
  getDocument,
  search,
} from "@cognitive-substrate/memory-opensearch";
import type { SessionDto, CreateSessionRequest } from "../types.js";

const SESSION_INDEX = "sessions";

interface SessionRecord {
  sessionId: string;
  userId?: string | undefined;
  name?: string | undefined;
  createdAt: string;
  messageCount: number;
  status: "active" | "idle";
}

// In-memory fallback for when OpenSearch is unavailable
const sessionCache = new Map<string, SessionRecord>();

function recordToDto(record: SessionRecord): SessionDto {
  return {
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    messageCount: record.messageCount,
    status: record.status,
    ...(record.userId !== undefined ? { userId: record.userId } : {}),
    ...(record.name !== undefined ? { name: record.name } : {}),
  };
}

async function persistSession(client: Client, record: SessionRecord): Promise<void> {
  try {
    await indexDocument(client, SESSION_INDEX, record.sessionId, {
      session_id: record.sessionId,
      user_id: record.userId,
      name: record.name,
      created_at: record.createdAt,
      message_count: record.messageCount,
      status: record.status,
    });
  } catch {
    // non-fatal: in-memory cache is the fallback
  }
}

interface SessionDoc extends Record<string, unknown> {
  readonly session_id?: string;
  readonly user_id?: string;
  readonly name?: string;
  readonly created_at?: string;
  readonly message_count?: number;
  readonly status?: "active" | "idle";
}

function docToRecord(doc: SessionDoc, id: string): SessionRecord {
  return {
    sessionId: doc.session_id ?? id,
    userId: doc.user_id,
    name: doc.name,
    createdAt: doc.created_at ?? new Date().toISOString(),
    messageCount: doc.message_count ?? 0,
    status: doc.status ?? "active",
  };
}

export function createSessionsRouter(openSearchClient: Client): Hono {
  const client = openSearchClient;
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json<CreateSessionRequest>().catch(() => ({} as CreateSessionRequest));
    const sessionId = uuidv4();
    const record: SessionRecord = {
      sessionId,
      createdAt: new Date().toISOString(),
      messageCount: 0,
      status: "active",
    };
    if (body.userId !== undefined) record.userId = body.userId;

    sessionCache.set(sessionId, record);
    await persistSession(client, record);

    return c.json(recordToDto(record), 201);
  });

  router.get("/", async (c) => {
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "50")));
    try {
      const hits = await search<SessionDoc>(client, SESSION_INDEX, {
        query: { match_all: {} },
        sort: [{ created_at: { order: "desc" } }],
        size: limit,
        _source: ["session_id", "user_id", "name", "created_at", "message_count", "status"],
      });
      const sessions = hits.map((h) => recordToDto(docToRecord(h._source, h._id)));
      return c.json({ sessions, total: sessions.length });
    } catch {
      // Fall back to in-memory cache
      const sessions = Array.from(sessionCache.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(recordToDto);
      return c.json({ sessions, total: sessions.length });
    }
  });

  router.get("/:id", async (c) => {
    const id = c.req.param("id");

    // Try cache first (most recent writes are always here)
    const cached = sessionCache.get(id);
    if (cached) return c.json(recordToDto(cached));

    // Try OpenSearch
    try {
      const doc = await getDocument<SessionDoc>(client, SESSION_INDEX, id);
      if (doc) {
        const record = docToRecord(doc, id);
        sessionCache.set(id, record);
        return c.json(recordToDto(record));
      }
    } catch {
      // fall through
    }

    return c.json({ error: "Session not found" }, 404);
  });

  router.patch("/:id", async (c) => {
    const id = c.req.param("id");
    interface PatchBody { name?: string; status?: "active" | "idle" }
    const body = await c.req.json<PatchBody>().catch((): PatchBody => ({}));

    let record = sessionCache.get(id);
    if (!record) {
      try {
        const doc = await getDocument<SessionDoc>(client, SESSION_INDEX, id);
        if (doc) record = docToRecord(doc, id);
      } catch {
        // fall through
      }
    }
    if (!record) return c.json({ error: "Session not found" }, 404);

    const updated: SessionRecord = {
      ...record,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    };
    sessionCache.set(id, updated);
    record = updated;

    try {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch["name"] = body.name;
      if (body.status !== undefined) patch["status"] = body.status;
      if (Object.keys(patch).length > 0) {
        await updateDocument(client, SESSION_INDEX, id, patch);
      }
    } catch {
      // non-fatal
    }

    return c.json(recordToDto(record));
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers called by other routes (messages.ts)
// ---------------------------------------------------------------------------

export function incrementSessionMessages(
  sessionId: string,
  client?: Client,
): void {
  const record = sessionCache.get(sessionId);
  if (record) {
    const updated = { ...record, messageCount: record.messageCount + 1 };
    sessionCache.set(sessionId, updated);
    if (client) {
      void updateDocument(client, SESSION_INDEX, sessionId, {
        message_count: updated.messageCount,
      }).catch(() => {});
    }
  }
}

export function getOrCreateSession(
  sessionId: string,
  userId?: string | undefined,
): SessionRecord {
  const existing = sessionCache.get(sessionId);
  if (existing) return existing;

  const record: SessionRecord = {
    sessionId,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    status: "active",
  };
  if (userId !== undefined) record.userId = userId;
  sessionCache.set(sessionId, record);
  return record;
}

/**
 * Set the auto-generated name on a session from its first message text.
 * Called by messages.ts on the first POST to a session.
 */
export function autoNameSession(
  sessionId: string,
  text: string,
  client: Client,
): void {
  const record = sessionCache.get(sessionId);
  if (!record || record.name) return; // already named
  const name = text.slice(0, 60).trim();
  const updated = { ...record, name };
  sessionCache.set(sessionId, updated);
  void updateDocument(client, SESSION_INDEX, sessionId, { name }).catch(() => {});
}
