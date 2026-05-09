/**
 * Hono application factory.
 * Mounts all route groups and configures middleware.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Client } from "@opensearch-project/opensearch";
import { sessionsRouter } from "./routes/sessions.js";
import { messagesRouter } from "./routes/messages.js";
import { streamRouter } from "./routes/stream.js";
import { createMemoriesRouter } from "./routes/memories.js";
import {
  createPolicyRouter,
  createAgentActivityRouter,
  createSelfmodRouter,
  createIdentityRouter,
  createGoalsRouter,
} from "./routes/policy.js";
import { createCollectorRouter } from "./routes/collector.js";

export function createApp(openSearchClient: Client): Hono {
  const app = new Hono();

  const corsOrigin = process.env["API_CORS_ORIGIN"] ?? "http://localhost:3000";

  app.use("*", cors({ origin: corsOrigin, allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.use("*", logger());

  app.get("/health", (c) =>
    c.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  app.route("/api/sessions", sessionsRouter);

  app.route("/api/sessions/:sessionId/messages", messagesRouter);
  app.route("/api/sessions/:sessionId/stream", streamRouter);

  const memoriesRouter = createMemoriesRouter(openSearchClient);
  app.route("/api/sessions/:sessionId/memories", memoriesRouter);

  // Roadmap Stage 4: policy state
  app.route("/api/sessions/:sessionId/policy", createPolicyRouter(openSearchClient));

  // Roadmap Stages 6-7: multi-agent activity (stub until Stage 6)
  app.route("/api/sessions/:sessionId/agents", createAgentActivityRouter(openSearchClient));

  // Roadmap Stage 8: self-modification proposals (stub until Stage 8)
  app.route("/api/sessions/:sessionId/selfmod", createSelfmodRouter(openSearchClient));

  // Roadmap Stages 9-10: identity state (stub until Stage 10)
  app.route("/api/sessions/:sessionId/identity", createIdentityRouter(openSearchClient));

  // Roadmap Stages 11-12: goal hierarchy (stub until Stage 12)
  app.route("/api/sessions/:sessionId/goals", createGoalsRouter(openSearchClient));

  // Direct operational control surface for the hosted Aiven telemetry collector.
  app.route("/api/collector", createCollectorRouter());

  return app;
}
