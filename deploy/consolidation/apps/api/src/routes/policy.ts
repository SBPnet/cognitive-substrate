/**
 * Policy state routes — Roadmap Stage 4.
 *
 * GET /api/sessions/:sessionId/policy  — current policy snapshot for the session
 *
 * Reads the most recent `policy_state` document from OpenSearch once the
 * policy engine (packages/policy-engine) begins writing versioned snapshots.
 * Until Stage 4 lands this returns a static default so the workbench can
 * render the policy panel from day one.
 */

import { Hono } from "hono";
import type { Client } from "@opensearch-project/opensearch";
import { search } from "@cognitive-substrate/memory-opensearch";
import type { AgentActivityDto, PolicySnapshotDto } from "../types.js";

interface PolicyStateDoc extends Record<string, unknown> {
  readonly policy_id?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly retrieval_bias?: number | undefined;
  readonly risk_tolerance?: number | undefined;
  readonly exploration_factor?: number | undefined;
}

const DEFAULT_POLICY: PolicySnapshotDto = {
  version: "default",
  timestamp: new Date().toISOString(),
  retrievalBias: 0.5,
  riskTolerance: 0.5,
  explorationFactor: 0.5,
};

export function createPolicyRouter(openSearchClient: Client): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

    try {
      const hits = await search<PolicyStateDoc>(client, "policy_state", {
        query: { match_all: {} },
        sort: [{ timestamp: { order: "desc" } }],
        size: 1,
        _source: [
          "policy_id",
          "timestamp",
          "retrieval_bias",
          "risk_tolerance",
          "exploration_factor",
        ],
      });

      if (hits.length === 0) return c.json(DEFAULT_POLICY);

      const doc = hits[0]!._source;
      const snapshot: PolicySnapshotDto = {
        version: doc.policy_id ?? "unknown",
        timestamp: doc.timestamp ?? new Date().toISOString(),
        retrievalBias: doc.retrieval_bias ?? 0.5,
        riskTolerance: doc.risk_tolerance ?? 0.5,
        explorationFactor: doc.exploration_factor ?? 0.5,
      };
      return c.json(snapshot);
    } catch {
      return c.json(DEFAULT_POLICY);
    }
  });

  const client = openSearchClient;
  return router;
}

// ---------------------------------------------------------------------------
// Stub exports for Stages 6-13 — add implementations as backend stages land
// ---------------------------------------------------------------------------

interface AgentActivityDoc extends Record<string, unknown> {
  readonly trace_id?: string;
  readonly timestamp?: string;
  readonly agent_type?: string;
  readonly input_summary?: string;
  readonly proposed_action?: string;
  readonly confidence?: number;
  readonly score?: number;
  readonly selected?: boolean;
  readonly critique?: string;
}

export function createAgentActivityRouter(client: Client): Hono {
  const router = new Hono();
  router.get("/", async (c) => {
    const limit = Math.max(1, Number(c.req.query("limit") ?? "30"));
    const hits = await search<AgentActivityDoc>(client, "agent_activity", {
      query: { match_all: {} },
      sort: [{ timestamp: { order: "desc" } }],
      size: limit,
      _source: [
        "trace_id",
        "timestamp",
        "agent_type",
        "input_summary",
        "proposed_action",
        "confidence",
        "score",
        "selected",
        "critique",
      ],
    });

    const activities: AgentActivityDto[] = hits.map((hit) => {
      const source = hit._source;
      const base: AgentActivityDto = {
        traceId: source.trace_id ?? hit._id,
        timestamp: source.timestamp ?? new Date().toISOString(),
        agentType: source.agent_type ?? "unknown",
        inputSummary: source.input_summary ?? "",
        proposedAction: source.proposed_action ?? "",
        confidence: source.confidence ?? 0,
        score: source.score ?? hit._score ?? 0,
        selected: source.selected ?? false,
      };
      return source.critique ? { ...base, critique: source.critique } : base;
    });

    return c.json({ activities, total: activities.length });
  });
  return router;
}

/**
 * Stage 8: Self-modification proposals.
 * Mount at /api/sessions/:sessionId/selfmod once metacog-engine lands.
 */
export function createSelfmodRouter(_client: Client): Hono {
  const router = new Hono();
  router.get("/", (c) =>
    c.json({
      message: "Self-modification view available from Stage 8",
      proposals: [],
    }),
  );
  return router;
}

/**
 * Stage 9-10: Reinforcement and identity.
 * Mount at /api/sessions/:sessionId/identity.
 */
export function createIdentityRouter(_client: Client): Hono {
  const router = new Hono();
  router.get("/", (c) =>
    c.json({
      message: "Identity state available from Stage 10",
    }),
  );
  return router;
}

/**
 * Stage 11-12: World model predictions and goal hierarchy.
 * Mount at /api/sessions/:sessionId/goals and /api/sessions/:sessionId/predictions.
 */
export function createGoalsRouter(_client: Client): Hono {
  const router = new Hono();
  router.get("/", (c) =>
    c.json({ message: "Goal hierarchy available from Stage 12", goals: [] }),
  );
  return router;
}
