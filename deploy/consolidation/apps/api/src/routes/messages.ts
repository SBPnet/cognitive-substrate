/**
 * Message submission route.
 *
 * POST /api/sessions/:sessionId/messages
 *
 * Accepts a user text message, constructs an ExperienceEvent, and publishes
 * it to `experience.raw`. The cognitive pipeline processes it asynchronously;
 * results arrive over the SSE stream at GET /api/sessions/:sessionId/stream.
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import type { ExperienceEvent, EventContext } from "@cognitive-substrate/core-types";
import type { SendMessageRequest, SendMessageResponse } from "../types.js";
import { publishExperienceEvent } from "../kafka/experience-producer.js";
import { getOrCreateSession, incrementSessionMessages } from "./sessions.js";

export const messagesRouter = new Hono();

messagesRouter.post("/", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  let body: SendMessageRequest;
  try {
    body = await c.req.json<SendMessageRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.text || body.text.trim().length === 0) {
    return c.json({ error: "Message text is required" }, 400);
  }

  const session = getOrCreateSession(sessionId);
  const eventId = uuidv4();
  const timestamp = new Date().toISOString();
  const traceId = uuidv4();

  const baseContext: EventContext = {
    sessionId: session.sessionId,
    traceId,
  };
  const context: EventContext = session.userId !== undefined
    ? { ...baseContext, userId: session.userId }
    : baseContext;

  const event: ExperienceEvent = {
    eventId,
    timestamp,
    type: "user_input",
    context,
    input: {
      text: body.text.trim(),
      embedding: [],
    },
    importanceScore: 0.5,
    tags: body.tags ? [...body.tags] : ["user_message"],
  };

  try {
    await publishExperienceEvent(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to queue message: ${message}` }, 503);
  }

  incrementSessionMessages(sessionId);

  const response: SendMessageResponse = {
    eventId,
    sessionId,
    timestamp,
    status: "queued",
  };

  return c.json(response, 202);
});
