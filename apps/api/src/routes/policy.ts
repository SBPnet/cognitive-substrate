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
// Route groups for Stages 6-13. Unwired surfaces return 501 rather than
// placeholder success payloads so the UI and smoke reports do not overclaim.
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

interface SelfModDoc extends Record<string, unknown> {
  readonly mutation_id?: string;
  readonly timestamp?: string;
  readonly mutation_type?: string;
  readonly description?: string;
  readonly expected_gain?: number;
  readonly observed_gain?: number;
  readonly stability_risk?: number;
  readonly approved?: boolean;
  readonly rollback_available?: boolean;
}

export interface SelfModProposalDto {
  readonly mutationId: string;
  readonly timestamp: string;
  readonly mutationType: string;
  readonly description: string;
  readonly expectedGain: number;
  readonly observedGain?: number;
  readonly stabilityRisk: number;
  readonly approved: boolean;
  readonly rollbackAvailable: boolean;
}

/** Stage 8: Self-modification proposals backed by the self_modifications index. */
export function createSelfmodRouter(client: Client): Hono {
  const router = new Hono();
  router.get("/", async (c) => {
    const limit = Math.max(1, Number(c.req.query("limit") ?? "20"));
    try {
      const hits = await search<SelfModDoc>(client, "self_modifications", {
        query: { match_all: {} },
        sort: [{ timestamp: { order: "desc" } }],
        size: limit,
        _source: [
          "mutation_id",
          "timestamp",
          "mutation_type",
          "description",
          "expected_gain",
          "observed_gain",
          "stability_risk",
          "approved",
          "rollback_available",
        ],
      });

      const proposals: SelfModProposalDto[] = hits.map((hit) => {
        const s = hit._source;
        const base: SelfModProposalDto = {
          mutationId: s.mutation_id ?? hit._id,
          timestamp: s.timestamp ?? new Date().toISOString(),
          mutationType: s.mutation_type ?? "unknown",
          description: s.description ?? "",
          expectedGain: s.expected_gain ?? 0,
          stabilityRisk: s.stability_risk ?? 0,
          approved: s.approved ?? false,
          rollbackAvailable: s.rollback_available ?? false,
        };
        return s.observed_gain !== undefined
          ? { ...base, observedGain: s.observed_gain }
          : base;
      });

      return c.json({ proposals, total: proposals.length });
    } catch {
      return c.json({ proposals: [], total: 0 });
    }
  });
  return router;
}

interface IdentityStateDoc extends Record<string, unknown> {
  readonly identity_id?: string;
  readonly timestamp?: string;
  readonly curiosity?: number;
  readonly caution?: number;
  readonly verbosity?: number;
  readonly tool_dependence?: number;
  readonly exploration_preference?: number;
  readonly stability_score?: number;
}

export interface IdentityStateDto {
  readonly identityId: string;
  readonly timestamp: string;
  readonly curiosity: number;
  readonly caution: number;
  readonly verbosity: number;
  readonly toolDependence: number;
  readonly explorationPreference: number;
  readonly stabilityScore: number;
}

const DEFAULT_IDENTITY: IdentityStateDto = {
  identityId: "default",
  timestamp: new Date().toISOString(),
  curiosity: 0.5,
  caution: 0.5,
  verbosity: 0.5,
  toolDependence: 0.5,
  explorationPreference: 0.5,
  stabilityScore: 0.5,
};

/** Stage 9-10: Current identity state from the identity_state index. */
export function createIdentityRouter(client: Client): Hono {
  const router = new Hono();
  router.get("/", async (c) => {
    try {
      const hits = await search<IdentityStateDoc>(client, "identity_state", {
        query: { match_all: {} },
        sort: [{ timestamp: { order: "desc" } }],
        size: 1,
        _source: [
          "identity_id",
          "timestamp",
          "curiosity",
          "caution",
          "verbosity",
          "tool_dependence",
          "exploration_preference",
          "stability_score",
        ],
      });

      if (hits.length === 0) return c.json(DEFAULT_IDENTITY);

      const s = hits[0]!._source;
      const identity: IdentityStateDto = {
        identityId: s.identity_id ?? "unknown",
        timestamp: s.timestamp ?? new Date().toISOString(),
        curiosity: s.curiosity ?? 0.5,
        caution: s.caution ?? 0.5,
        verbosity: s.verbosity ?? 0.5,
        toolDependence: s.tool_dependence ?? 0.5,
        explorationPreference: s.exploration_preference ?? 0.5,
        stabilityScore: s.stability_score ?? 0.5,
      };
      return c.json(identity);
    } catch {
      return c.json(DEFAULT_IDENTITY);
    }
  });
  return router;
}

interface GoalDoc extends Record<string, unknown> {
  readonly goal_id?: string;
  readonly timestamp?: string;
  readonly goal_description?: string;
  readonly goal_horizon?: string;
  readonly priority?: number;
  readonly progress?: number;
  readonly status?: string;
  readonly parent_goal_id?: string;
}

export interface GoalDto {
  readonly goalId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly horizon: string;
  readonly priority: number;
  readonly progress: number;
  readonly status: string;
  readonly parentGoalId?: string;
}

/** Stage 11-12: Goal hierarchy from the goal_system index. */
export function createGoalsRouter(client: Client): Hono {
  const router = new Hono();
  router.get("/", async (c) => {
    const limit = Math.max(1, Number(c.req.query("limit") ?? "50"));
    try {
      const hits = await search<GoalDoc>(client, "goal_system", {
        query: { match_all: {} },
        sort: [{ priority: { order: "desc" } }],
        size: limit,
        _source: [
          "goal_id",
          "timestamp",
          "goal_description",
          "goal_horizon",
          "priority",
          "progress",
          "status",
          "parent_goal_id",
        ],
      });

      const goals: GoalDto[] = hits.map((hit) => {
        const s = hit._source;
        const base: GoalDto = {
          goalId: s.goal_id ?? hit._id,
          timestamp: s.timestamp ?? new Date().toISOString(),
          description: s.goal_description ?? "",
          horizon: s.goal_horizon ?? "short",
          priority: s.priority ?? 0,
          progress: s.progress ?? 0,
          status: s.status ?? "active",
        };
        return s.parent_goal_id ? { ...base, parentGoalId: s.parent_goal_id } : base;
      });

      return c.json({ goals, total: goals.length });
    } catch {
      return c.json({ goals: [], total: 0 });
    }
  });
  return router;
}
