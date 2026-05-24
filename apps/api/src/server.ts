/**
 * Hono application factory.
 * Mounts all route groups and configures middleware.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Client } from "@opensearch-project/opensearch";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { IngestMapperPlugin, ApiRouterPlugin } from "@cognitive-substrate/plugin-loader";
import { createSessionsRouter } from "./routes/sessions.js";
import { createMessagesRouter } from "./routes/messages.js";
import { streamRouter } from "./routes/stream.js";
import { createMemoriesRouter } from "./routes/memories.js";
import {
  createPolicyRouter,
  createAgentActivityRouter,
  createSelfmodRouter,
  createIdentityRouter,
  createGoalsRouter,
} from "./routes/policy.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createProposalsRouter } from "./routes/proposals.js";

export type { ApiRouterPlugin };

export function createApp(
  openSearchClient: Client,
  getMetadataProducer?: () => CognitiveProducer | null,
  ingestMapperPlugins: ReadonlyArray<IngestMapperPlugin> = [],
  apiRouterPlugins: ReadonlyArray<ApiRouterPlugin> = [],
): Hono {
  const app = new Hono();

  const corsOrigin = process.env["API_CORS_ORIGIN"] ?? "http://localhost:3000";

  app.use("*", cors({ origin: corsOrigin, allowMethods: ["GET", "POST", "PATCH", "OPTIONS"] }));
  app.use("*", logger());

  app.get("/health", (c) =>
    c.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  app.route("/api/sessions", createSessionsRouter(openSearchClient));

  app.route("/api/sessions/:sessionId/messages", createMessagesRouter(openSearchClient));
  app.route("/api/sessions/:sessionId/documents", createDocumentsRouter());
  app.route("/api/sessions/:sessionId/stream", streamRouter);

  const memoriesRouter = createMemoriesRouter(openSearchClient);
  app.route("/api/sessions/:sessionId/memories", memoriesRouter);

  // Roadmap Stage 4: policy state
  app.route("/api/sessions/:sessionId/policy", createPolicyRouter(openSearchClient));

  // Roadmap Stages 6-7: multi-agent activity (stub until Stage 6)
  app.route("/api/sessions/:sessionId/agents", createAgentActivityRouter(openSearchClient));

  // Roadmap Stage 8: self-modification proposals (self_modifications index)
  app.route("/api/sessions/:sessionId/selfmod", createSelfmodRouter(openSearchClient));

  // Roadmap Stages 9-10: identity state (identity_state index)
  app.route("/api/sessions/:sessionId/identity", createIdentityRouter(openSearchClient));

  // Roadmap Stages 11-12: goal hierarchy (goal_system index)
  app.route("/api/sessions/:sessionId/goals", createGoalsRouter(openSearchClient));

  // IntrospectionEngine: human review of self-modification proposals
  app.route("/api/admin/proposals", createProposalsRouter(openSearchClient));

  // Ingest-mapper webhook receivers (one per plugin that opts in).
  if (getMetadataProducer) {
    for (const plugin of ingestMapperPlugins) {
      if (plugin.createWebhookRouter) {
        const handle = plugin.handles[0];
        if (handle) {
          app.route(`/api/webhooks/${handle}`, plugin.createWebhookRouter(getMetadataProducer));
        }
      }
    }
  }

  // Integration router plugins (control-plane routes, provider webhooks, etc.).
  const producer = getMetadataProducer ?? (() => null);
  for (const routerPlugin of apiRouterPlugins) {
    app.route(routerPlugin.mountPath, routerPlugin.createRouter(producer));
  }

  return app;
}
