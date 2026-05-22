/**
 * Server-Sent Events stream for a cognitive session.
 *
 * GET /api/sessions/:sessionId/stream
 *
 * Emits two event types:
 *   interaction_response  — orchestrator responses (from SessionEventBus)
 *   kafka_event           — cognitive pipeline events (from KafkaEventBus)
 *
 * A keepalive ping is sent every 15 seconds to prevent proxy timeouts.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { InteractionResponseEvent } from "@cognitive-substrate/core-types";
import { sessionEventBus } from "../kafka/session-bus.js";
import { kafkaEventBus } from "../kafka/kafka-event-bus.js";
import type { SseEnvelope, InteractionResponseDto, KafkaEventDto } from "../types.js";

export const streamRouter = new Hono();

streamRouter.get("/", (c) => {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  return streamSSE(c, async (stream) => {
    const pingInterval = setInterval(() => {
      void stream.writeSSE({
        event: "ping",
        data: JSON.stringify({ timestamp: new Date().toISOString() }),
      });
    }, 15_000);

    const unsubscribeResponse = sessionEventBus.subscribe(
      sessionId,
      (event: InteractionResponseEvent) => {
        const dto: InteractionResponseDto = {
          eventId: event.eventId,
          sessionId: event.sessionId,
          traceId: event.traceId,
          timestamp: event.timestamp,
          status: event.status,
          responseText: event.responseText,
          confidence: event.confidence,
          riskScore: event.riskScore,
          ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
        };

        const envelope: SseEnvelope<InteractionResponseDto> = {
          type: "interaction_response",
          payload: dto,
        };

        void stream.writeSSE({
          event: "interaction_response",
          data: JSON.stringify(envelope),
          id: event.eventId,
        });
      },
    );

    const unsubscribeKafka = kafkaEventBus.subscribe(
      sessionId,
      (event: KafkaEventDto) => {
        const envelope: SseEnvelope<KafkaEventDto> = {
          type: "kafka_event",
          payload: event,
        };
        void stream.writeSSE({
          event: "kafka_event",
          data: JSON.stringify(envelope),
        });
      },
    );

    stream.onAbort(() => {
      clearInterval(pingInterval);
      unsubscribeResponse();
      unsubscribeKafka();
    });

    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ sessionId, timestamp: new Date().toISOString() }),
    });

    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });

    clearInterval(pingInterval);
    unsubscribeResponse();
    unsubscribeKafka();
  });
});
