/**
 * Session management routes.
 *
 * POST /api/sessions        — create a new session
 * GET  /api/sessions/:id    — fetch session metadata
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import type { SessionDto, CreateSessionRequest } from "../types.js";

interface SessionRecord {
  sessionId: string;
  userId?: string | undefined;
  createdAt: string;
  messageCount: number;
}

const sessionStore = new Map<string, SessionRecord>();

export const sessionsRouter = new Hono();

sessionsRouter.post("/", async (c) => {
  const body = await c.req.json<CreateSessionRequest>().catch(() => ({} as CreateSessionRequest));
  const sessionId = uuidv4();
  const record: SessionRecord = {
    sessionId,
    createdAt: new Date().toISOString(),
    messageCount: 0,
  };
  if (body.userId !== undefined) record.userId = body.userId;
  sessionStore.set(sessionId, record);

  const dto: SessionDto = {
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    messageCount: 0,
    status: "active",
  };
  if (record.userId !== undefined) {
    return c.json({ ...dto, userId: record.userId } as SessionDto, 201);
  }
  return c.json(dto, 201);
});

sessionsRouter.get("/:id", (c) => {
  const id = c.req.param("id");
  const record = sessionStore.get(id);
  if (!record) return c.json({ error: "Session not found" }, 404);

  const dto: SessionDto = {
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    messageCount: record.messageCount,
    status: "active",
  };
  if (record.userId !== undefined) {
    return c.json({ ...dto, userId: record.userId });
  }
  return c.json(dto);
});

export function incrementSessionMessages(sessionId: string): void {
  const record = sessionStore.get(sessionId);
  if (record) {
    sessionStore.set(sessionId, { ...record, messageCount: record.messageCount + 1 });
  }
}

export function getOrCreateSession(sessionId: string, userId?: string | undefined): SessionRecord {
  const existing = sessionStore.get(sessionId);
  if (existing) return existing;

  const record: SessionRecord = {
    sessionId,
    createdAt: new Date().toISOString(),
    messageCount: 0,
  };
  if (userId !== undefined) record.userId = userId;
  sessionStore.set(sessionId, record);
  return record;
}
