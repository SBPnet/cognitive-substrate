/**
 * Aiven project event webhook receiver.
 *
 * Aiven POSTs project-level events (service state changes, user actions,
 * alerts, backup completions, etc.) to this endpoint in real time.
 * Each event is published to TELEMETRY_METADATA_RAW so the telemetry
 * pipeline processes it exactly as the polling path did, without the
 * collector needing to call the Aiven events REST API on a timer.
 *
 * Configuring the webhook in Aiven:
 *   Console: Project Settings → Webhooks → Add webhook
 *     URL:     https://<api-host>/api/aiven/webhook
 *     Secret:  set AIVEN_WEBHOOK_SECRET in this service's env
 *   Events:   select "All events" or choose specific event types
 *
 * Security: Aiven signs each request with HMAC-SHA256 over the raw body
 * using the shared secret.  The signature is delivered in the
 * "x-aiven-signature" header as "sha256=<hex-digest>".  Requests that
 * fail signature verification are rejected with 401.
 */

import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Topics,
  type CognitiveProducer,
} from "@cognitive-substrate/kafka-bus";

interface AivenWebhookPayload {
  readonly event_type?: string;
  readonly event_desc?: string;
  readonly service_name?: string;
  readonly project?: string;
  readonly time?: string;
  readonly id?: string;
  readonly [key: string]: unknown;
}

export function createAivenWebhookRouter(getProducer: () => CognitiveProducer | null): Hono {
  const router = new Hono();
  const secret = process.env["AIVEN_WEBHOOK_SECRET"];
  const environment = process.env["ENVIRONMENT"] ?? process.env["AIVEN_PROJECT"] ?? "unknown";

  router.post("/", async (c) => {
    const producer = getProducer();
    if (!producer) return c.json({ error: "telemetry pipeline not ready" }, 503);

    const rawBody = await c.req.arrayBuffer();
    const bodyBytes = Buffer.from(rawBody);

    if (secret) {
      const sig = c.req.header("x-aiven-signature") ?? "";
      if (!verifySignature(bodyBytes, secret, sig)) {
        return c.json({ error: "invalid signature" }, 401);
      }
    }

    let payload: AivenWebhookPayload;
    try {
      payload = JSON.parse(bodyBytes.toString("utf8")) as AivenWebhookPayload;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const timestamp = payload.time ?? new Date().toISOString();
    const eventId =
      payload.id ??
      `${payload.service_name ?? "project"}:${payload.event_type ?? "event"}:${timestamp}`;

    await producer.publish(
      Topics.TELEMETRY_METADATA_RAW,
      {
        project: payload.project ?? environment,
        source: "aiven.project_event",
        snapshot: payload,
        timestamp,
        environment,
        ...(payload.service_name ? { serviceId: payload.service_name } : {}),
      },
      { key: eventId },
    );

    return c.json({ received: true }, 200);
  });

  return router;
}

function verifySignature(body: Buffer, secret: string, header: string): boolean {
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuf = Buffer.from(prefix + expected, "utf8");
  const actualBuf = Buffer.from(header, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
