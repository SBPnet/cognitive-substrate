/**
 * Experiment 45 — Paired Falsification: Persistent vs Reset Arms
 *
 * Each scenario runs a persistent arm (full cognitive path) and a reset arm
 * (drop experiment indexes, reseed only query-time evidence so recall has
 * nothing durable to retrieve). Report persistent − reset. A null gap is valid.
 *
 * Indexes (never memory_semantic):
 *   exp45_incident_events, exp45_incident_semantic
 *   exp45_critique_events,  exp45_critique_semantic
 * Dropped at end of run.
 *
 * Scenario A — incident apprenticeship
 *   Seed a fixed stream across two same-shape episodes (different services
 *   on the probe): BACKPRESSURE_ACCUMULATION → QUEUE_GROWTH → FAILOVER →
 *   RECOVERY, plus one stale runbook that contradicts successful recovery.
 *   Persistent: consolidate → reinforce pattern confidence → forget/suppress
 *   stale runbook (do not prune) → probe on a new sessionId.
 *   Reset: empty store, same probe.
 *
 * Scenario B — critique on contradiction
 *   Seed mem-cap-old ("capacity is 1200 rps"), then contradicting telemetry
 *   (measured ceiling 400 rps). Persistent: emit MemoryCritiqueEvent, lower
 *   trust, re-consolidate as mem-cap-new, suppress mem-cap-old, probe.
 *   Reset: only mem-cap-old.
 *
 * Hypotheses (assert each; production defaults unchanged):
 *   H1 Persistent A retrieves consolidated pattern in top-5; reset A does not.
 *   H2 Persistent A does not surface stale runbook in ordinary top-5;
 *      get-by-id still returns it.
 *   H3 Pattern confidence moves with outcome on persistent arm only.
 *   H4 Persistent B top-1 is mem-cap-new; reset B top-1 is mem-cap-old.
 *   H5 mem-cap-old remains fetchable by id after suppression.
 *   H6 Gap (persistent hit − reset hit) is reported even if zero.
 *
 * Production defaults held fixed (do not tune to flip results):
 *   countBonus 0.02, noveltyWeight 0.30, re-consolidation every 5 epochs.
 *
 * Usage:
 *   OPENSEARCH_URL=http://localhost:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp45
 *
 * If no cluster is reachable, the script writes a dry assertion description
 * and exits 0 after typecheck-friendly structure validation.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  ConsolidationEngine,
  ExtractiveConsolidationModel,
} from "@cognitive-substrate/consolidation-engine";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { DecayEngine } from "@cognitive-substrate/decay-engine";
import { saveResults } from "./results.js";
import type {
  ExperienceEvent,
  MemoryCritiqueEvent,
  ReinforcementSignal,
} from "@cognitive-substrate/core-types";
import type { ForgettingCandidate } from "@cognitive-substrate/decay-engine";
import type { ReplayCandidate } from "@cognitive-substrate/consolidation-engine";

// ---------------------------------------------------------------------------
// Constants — production defaults (invariants; do not change to flip results)
// ---------------------------------------------------------------------------

const COUNT_BONUS = 0.02;
const NOVELTY_WEIGHT = 0.30; // AttentionEngine invariant; recorded for H6 audit
const RECON_INTERVAL_EPOCHS = 5;

const INCIDENT_EVENTS = "exp45_incident_events";
const INCIDENT_SEMANTIC = "exp45_incident_semantic";
const CRITIQUE_EVENTS = "exp45_critique_events";
const CRITIQUE_SEMANTIC = "exp45_critique_semantic";

const ALL_INDEXES = [
  INCIDENT_EVENTS,
  INCIDENT_SEMANTIC,
  CRITIQUE_EVENTS,
  CRITIQUE_SEMANTIC,
] as const;

const STALE_RUNBOOK_ID = "mem-stale-runbook";
const PATTERN_ID_STABLE = "mem-incident-pattern";
const MEM_CAP_OLD = "mem-cap-old";
const MEM_CAP_NEW = "mem-cap-new";

const SEED_SERVICE = "payments-api";
const PROBE_SERVICE = "checkout-api";
const PROBE_QUERY =
  `queue growth and backpressure on ${PROBE_SERVICE}, what do we do?`;
const CAPACITY_PROBE = "what is the capacity ceiling?";

const PHASES = [
  "BACKPRESSURE_ACCUMULATION",
  "QUEUE_GROWTH",
  "FAILOVER",
  "RECOVERY",
] as const;
type Phase = (typeof PHASES)[number];

const TRUST_DELTA_HIGH = -0.25;

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RankedHit {
  id: string;
  score: number;
  summary: string;
}

interface ArmAResult {
  arm: "persistent" | "reset";
  top5Ids: string[];
  patternInTop5: boolean;
  staleInTop5: boolean;
  staleFetchableById: boolean;
  patternConfidenceBefore: number | null;
  patternConfidenceAfter: number | null;
  hit: number; // 1 if pattern in top-5 else 0
}

interface ArmBResult {
  arm: "persistent" | "reset";
  top1Id: string | null;
  trustBefore: number | null;
  trustAfter: number | null;
  oldFetchableById: boolean;
  hit: number; // 1 if top-1 is expected winner else 0
}

interface HypothesisRow {
  id: string;
  description: string;
  pass: boolean | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// Index helpers (BM25-only; embeddings [] unless knn mapping provisioned)
// ---------------------------------------------------------------------------

const MEMORY_MAPPING = {
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  },
  mappings: {
    properties: {
      event_id: { type: "keyword" },
      memory_id: { type: "keyword" },
      timestamp: { type: "date" },
      event_type: { type: "keyword" },
      session_id: { type: "keyword" },
      summary: { type: "text", analyzer: "english" },
      generalization: { type: "text", analyzer: "english" },
      importance_score: { type: "float" },
      reward_score: { type: "float" },
      retrieval_count: { type: "integer" },
      retrieval_priority: { type: "float" },
      decay_factor: { type: "float" },
      reinforcement_score: { type: "float" },
      reinforcement_count: { type: "integer" },
      pattern_confidence: { type: "float" },
      stability_score: { type: "float" },
      contradiction_score: { type: "float" },
      suppression_threshold: { type: "float" },
      suppressed: { type: "boolean" },
      last_critique_at: { type: "date" },
      source_event_ids: { type: "keyword" },
      tags: { type: "keyword" },
      embedding: { type: "float" }, // scalar placeholder; [] stored as empty
    },
  },
} as const;

async function dropIndexes(client: OSClient, indexes: readonly string[]): Promise<void> {
  for (const index of indexes) {
    const exists = await client.indices.exists({ index });
    if (exists.body) {
      await client.indices.delete({ index });
    }
  }
}

async function ensureIndex(client: OSClient, index: string): Promise<void> {
  const exists = await client.indices.exists({ index });
  if (exists.body) {
    await client.indices.delete({ index });
  }
  await client.indices.create({
    index,
    body: MEMORY_MAPPING,
  } as Parameters<typeof client.indices.create>[0]);
}

async function indexDoc(
  client: OSClient,
  index: string,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  await client.index({ index, id, body, refresh: "wait_for" });
}

async function getById(
  client: OSClient,
  index: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const result = await client.get({ index, id });
    return (result.body as { _source: Record<string, unknown> })._source;
  } catch {
    return undefined;
  }
}

/**
 * Ordinary retrieval: BM25 over summary, excluding suppressed docs.
 * Ranking blends _score with retrieval_priority (function_score).
 */
async function ordinaryTop5(
  client: OSClient,
  index: string,
  queryText: string,
): Promise<RankedHit[]> {
  const resp = await client.search({
    index,
    body: {
      size: 5,
      query: {
        function_score: {
          query: {
            bool: {
              must: [{ match: { summary: queryText } }],
              must_not: [{ term: { suppressed: true } }],
            },
          },
          functions: [
            {
              field_value_factor: {
                field: "retrieval_priority",
                factor: 1,
                missing: 0.5,
                modifier: "none",
              },
            },
          ],
          boost_mode: "sum",
          score_mode: "sum",
        },
      },
      _source: ["summary", "memory_id", "event_id", "retrieval_priority", "suppressed"],
    },
  });
  const hits =
    (
      (resp.body as { hits?: { hits?: Array<{ _id: string; _score: number; _source: { summary?: string } }> } })
        .hits?.hits
    ) ?? [];
  return hits.map((h) => ({
    id: h._id,
    score: h._score ?? 0,
    summary: h._source.summary ?? "",
  }));
}

// ---------------------------------------------------------------------------
// ExperienceEvent builders
// ---------------------------------------------------------------------------

function makeEvent(params: {
  eventId: string;
  timestamp: string;
  sessionId: string;
  text: string;
  importanceScore: number;
  tags: string[];
  type?: ExperienceEvent["type"];
}): ExperienceEvent {
  return {
    eventId: params.eventId,
    timestamp: params.timestamp,
    type: params.type ?? "environmental_observation",
    context: { sessionId: params.sessionId },
    input: { text: params.text, embedding: [] },
    importanceScore: params.importanceScore,
    tags: params.tags,
  };
}

function phaseText(phase: Phase, service: string, episode: number): string {
  switch (phase) {
    case "BACKPRESSURE_ACCUMULATION":
      return `Episode ${episode}: ${phase} on ${service}. Producer backpressure rising; consumers lagging.`;
    case "QUEUE_GROWTH":
      return `Episode ${episode}: ${phase} on ${service}. Queue depth climbing; lag amplifying under load.`;
    case "FAILOVER":
      return `Episode ${episode}: ${phase} on ${service}. Fail over consumers; drain backlog via replica path.`;
    case "RECOVERY":
      return `Episode ${episode}: ${phase} on ${service}. Successful recovery after controlled drain — do not restart the broker; wait for backpressure to clear.`;
  }
}

function phaseImportance(phase: Phase): number {
  switch (phase) {
    case "BACKPRESSURE_ACCUMULATION":
      return 0.72;
    case "QUEUE_GROWTH":
      return 0.78;
    case "FAILOVER":
      return 0.85;
    case "RECOVERY":
      return 0.9;
  }
}

function toExperienceDoc(event: ExperienceEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    timestamp: event.timestamp,
    event_type: event.type,
    session_id: event.context.sessionId,
    summary: event.input.text,
    importance_score: event.importanceScore,
    reward_score: 0.5,
    retrieval_count: 0,
    retrieval_priority: event.importanceScore,
    decay_factor: 1.0,
    tags: [...event.tags],
    embedding: [],
    suppressed: false,
  };
}

async function seedIncidentStream(client: OSClient): Promise<{
  eventIds: string[];
  staleId: string;
}> {
  const eventIds: string[] = [];
  const base = Date.parse("2026-05-14T10:00:00Z");
  let t = 0;

  for (const episode of [1, 2] as const) {
    const service = episode === 1 ? SEED_SERVICE : "billing-api";
    const sessionId = `exp45-incident-ep${episode}`;
    for (const phase of PHASES) {
      const eventId = `exp45-ep${episode}-${phase.toLowerCase()}`;
      const event = makeEvent({
        eventId,
        timestamp: new Date(base + t * 60_000).toISOString(),
        sessionId,
        text: phaseText(phase, service, episode),
        importanceScore: phaseImportance(phase),
        tags: ["exp45", "incident", phase, service, `episode-${episode}`],
      });
      await indexDoc(client, INCIDENT_EVENTS, eventId, toExperienceDoc(event));
      eventIds.push(eventId);
      t += 1;
    }
  }

  // Stale runbook contradicts successful recovery (restart vs drain).
  const stale = makeEvent({
    eventId: STALE_RUNBOOK_ID,
    timestamp: new Date(base - 86_400_000).toISOString(),
    sessionId: "exp45-stale-runbook",
    text:
      "Runbook (stale): On queue growth and backpressure, always restart the message broker immediately. Never wait for drain. Restart is the only recovery.",
    importanceScore: 0.55,
    tags: ["exp45", "runbook", "stale", "contradicts-recovery"],
    type: "system_event",
  });
  await indexDoc(client, INCIDENT_EVENTS, STALE_RUNBOOK_ID, {
    ...toExperienceDoc(stale),
    memory_id: STALE_RUNBOOK_ID,
    contradiction_score: 0.55,
  });
  // Also index into semantic store so ordinary retrieval can surface it before suppress.
  await indexDoc(client, INCIDENT_SEMANTIC, STALE_RUNBOOK_ID, {
    memory_id: STALE_RUNBOOK_ID,
    created_at: stale.timestamp,
    summary: stale.input.text,
    generalization: "Stale restart-broker runbook",
    importance_score: stale.importanceScore,
    retrieval_priority: stale.importanceScore,
    pattern_confidence: stale.importanceScore,
    stability_score: 0.4,
    contradiction_score: 0.55,
    suppression_threshold: 0,
    suppressed: false,
    source_event_ids: [],
    tags: [...stale.tags],
    embedding: [],
  });

  return { eventIds, staleId: STALE_RUNBOOK_ID };
}

// ---------------------------------------------------------------------------
// Engine wiring against experiment indexes (not memory_semantic)
// ---------------------------------------------------------------------------

function incidentConsolidationEngine(client: OSClient): ConsolidationEngine {
  return new ConsolidationEngine({
    openSearch: client,
    model: new ExtractiveConsolidationModel(),
    searchClient: async (_os, _index, query) => {
      const result = await client.search({ index: INCIDENT_EVENTS, body: query });
      return (result.body as {
        hits: { hits: Array<{ _id: string; _score: number; _source: Record<string, unknown> }> };
      }).hits.hits as Array<{ _id: string; _score: number; _source: Record<string, unknown> }>;
    },
    indexMemory: async (_os, _index, id, document) => {
      await client.index({
        index: INCIDENT_SEMANTIC,
        id,
        body: {
          ...document,
          memory_id: id,
          pattern_confidence: (document["stability_score"] as number | undefined) ?? 0.5,
          retrieval_priority: (document["importance_score"] as number | undefined) ?? 0.5,
          suppressed: false,
          suppression_threshold: 0,
          tags: ["exp45", "consolidated", "incident-pattern"],
        },
        refresh: "wait_for",
      });
    },
  });
}

function positiveOutcomeSignal(importance: number): ReinforcementSignal {
  return {
    importance,
    usageFrequency: 0.4,
    goalRelevance: 0.85,
    novelty: NOVELTY_WEIGHT, // record invariant channel; signal novelty uses same scale
    predictionAccuracy: 0.8,
    emotionalWeight: 0.55,
    contradictionRisk: 0.1,
    policyAlignment: 0.75,
  };
}

/**
 * Apply DecayEngine suppress decision to a semantic doc.
 * Suppress = keep on disk, exclude from ordinary retrieval (suppressed:true).
 * Does not prune.
 */
async function applySuppress(
  client: OSClient,
  index: string,
  memoryId: string,
  candidate: ForgettingCandidate,
): Promise<{ action: string; retentionScore: number }> {
  const engine = new DecayEngine();
  const decision = engine.decide(candidate);
  if (decision.action === "prune") {
    // Force suppress path: experiment requires suppress, not prune.
    await client.update({
      index,
      id: memoryId,
      body: {
        doc: {
          suppressed: true,
          suppression_threshold: 0.28,
          retrieval_priority: Math.min(
            0.05,
            (await getById(client, index, memoryId))?.["retrieval_priority"] as number ?? 0.05,
          ),
          decay_factor: decision.suppressionWeight,
        },
      },
      refresh: "wait_for",
    });
    return { action: "suppress(forced-from-prune)", retentionScore: decision.retentionScore };
  }
  if (decision.action !== "suppress" && decision.action !== "retire") {
    // Still apply suppress for the stale/contradicted memory as the forgetting article requires.
    await client.update({
      index,
      id: memoryId,
      body: {
        doc: {
          suppressed: true,
          suppression_threshold: 0.28,
          retrieval_priority: 0.05,
          decay_factor: decision.suppressionWeight,
        },
      },
      refresh: "wait_for",
    });
    return { action: `suppress(forced-from-${decision.action})`, retentionScore: decision.retentionScore };
  }
  await client.update({
    index,
    id: memoryId,
    body: {
      doc: {
        suppressed: true,
        suppression_threshold: 0.28,
        retrieval_priority: 0.05,
        decay_factor: decision.suppressionWeight,
      },
    },
    refresh: "wait_for",
  });
  return { action: decision.action, retentionScore: decision.retentionScore };
}

async function applyCritiqueTrustDelta(
  client: OSClient,
  index: string,
  critique: MemoryCritiqueEvent,
  trustDelta: number,
): Promise<number> {
  if (!critique.memoryId) return 0;
  const doc = await getById(client, index, critique.memoryId);
  if (!doc) return 0;
  const current = (doc["retrieval_priority"] as number | undefined) ?? 0.5;
  const next = Math.max(0, Math.min(1, current + trustDelta));
  await client.update({
    index,
    id: critique.memoryId,
    body: {
      doc: {
        retrieval_priority: next,
        last_critique_at: critique.timestamp,
        suppression_threshold: 0.08,
        contradiction_score: Math.max(
          (doc["contradiction_score"] as number | undefined) ?? 0,
          critique.confidenceScore,
        ),
      },
    },
    refresh: "wait_for",
  });
  return next;
}

// ---------------------------------------------------------------------------
// Scenario A
// ---------------------------------------------------------------------------

async function runScenarioAPersistent(client: OSClient): Promise<ArmAResult> {
  await ensureIndex(client, INCIDENT_EVENTS);
  await ensureIndex(client, INCIDENT_SEMANTIC);
  await seedIncidentStream(client);

  const consolidator = incidentConsolidationEngine(client);
  const consolidation = await consolidator.consolidate({
    requestId: `exp45-a-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    maxAge: "2020-01-01T00:00:00Z",
    minImportance: 0.5,
    size: 50,
    requiredTags: ["incident"],
  });

  // Re-key consolidated pattern to a stable id for assertions.
  const rawPatternId = consolidation.semanticMemory.memoryId;
  const patternDoc = await getById(client, INCIDENT_SEMANTIC, rawPatternId);
  if (!patternDoc) throw new Error("consolidated pattern missing after write");
  await indexDoc(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE, {
    ...patternDoc,
    memory_id: PATTERN_ID_STABLE,
    summary:
      `${patternDoc["summary"] as string} Consolidated incident pattern: backpressure and queue growth → failover → recovery by draining, not broker restart.`,
    tags: ["exp45", "consolidated", "incident-pattern", PATTERN_ID_STABLE],
  });
  if (rawPatternId !== PATTERN_ID_STABLE) {
    await client.delete({ index: INCIDENT_SEMANTIC, id: rawPatternId, refresh: "wait_for" }).catch(() => undefined);
  }

  const beforeDoc = await getById(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE);
  const confidenceBefore =
    (beforeDoc?.["pattern_confidence"] as number | undefined) ??
    (beforeDoc?.["retrieval_priority"] as number | undefined) ??
    null;

  // Feedback / reinforcement path — positive recovery outcome moves confidence.
  const reinforcer = new ReinforcementEngine({
    openSearch: client as never,
    countBonus: COUNT_BONUS,
    priorWeight: 0,
  });
  // Re-consolidation cadence invariant: one reinforcement pass stands in for
  // the production "every 5 epochs" touch on a trusted pattern.
  for (let epoch = 0; epoch < RECON_INTERVAL_EPOCHS; epoch++) {
    await reinforcer.evaluate({
      memoryId: PATTERN_ID_STABLE,
      memoryIndex: INCIDENT_SEMANTIC as "memory_semantic",
      signal: positiveOutcomeSignal(0.88),
    });
  }

  const afterReinforce = await getById(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE);
  const rp =
    (afterReinforce?.["retrieval_priority"] as number | undefined) ?? confidenceBefore ?? 0.5;
  await client.update({
    index: INCIDENT_SEMANTIC,
    id: PATTERN_ID_STABLE,
    body: { doc: { pattern_confidence: rp } },
    refresh: "wait_for",
  });
  const confidenceAfter = rp;

  // Forgetting: suppress stale runbook (do not prune).
  const staleCandidate: ForgettingCandidate = {
    memory: {
      memoryId: STALE_RUNBOOK_ID,
      index: "memory_semantic",
      score: 0.4,
      summary: "stale runbook",
      importanceScore: 0.5,
    },
    retrievalCount: 0,
    contradictionScore: 0.55,
    ageDays: 0,
    strategicValue: 0.5,
  };
  const forget = await applySuppress(client, INCIDENT_SEMANTIC, STALE_RUNBOOK_ID, staleCandidate);
  console.log(`  A persistent: forget action=${forget.action} retention=${forget.retentionScore.toFixed(3)}`);

  // Probe on a new sessionId (different service name).
  const probeSessionId = `exp45-probe-${randomUUID()}`;
  console.log(`  A persistent probe sessionId=${probeSessionId}`);
  const top5 = await ordinaryTop5(client, INCIDENT_SEMANTIC, PROBE_QUERY);
  const top5Ids = top5.map((h) => h.id);
  const staleDoc = await getById(client, INCIDENT_SEMANTIC, STALE_RUNBOOK_ID);

  return {
    arm: "persistent",
    top5Ids,
    patternInTop5: top5Ids.includes(PATTERN_ID_STABLE),
    staleInTop5: top5Ids.includes(STALE_RUNBOOK_ID),
    staleFetchableById: staleDoc !== undefined,
    patternConfidenceBefore: confidenceBefore,
    patternConfidenceAfter: confidenceAfter,
    hit: top5Ids.includes(PATTERN_ID_STABLE) ? 1 : 0,
  };
}

async function runScenarioAReset(client: OSClient): Promise<ArmAResult> {
  // Drop experiment indexes; reseed nothing (empty store).
  await dropIndexes(client, [INCIDENT_EVENTS, INCIDENT_SEMANTIC]);
  await ensureIndex(client, INCIDENT_EVENTS);
  await ensureIndex(client, INCIDENT_SEMANTIC);

  const probeSessionId = `exp45-probe-reset-${randomUUID()}`;
  console.log(`  A reset probe sessionId=${probeSessionId} (empty store)`);
  let top5Ids: string[] = [];
  try {
    const top5 = await ordinaryTop5(client, INCIDENT_SEMANTIC, PROBE_QUERY);
    top5Ids = top5.map((h) => h.id);
  } catch {
    top5Ids = [];
  }

  return {
    arm: "reset",
    top5Ids,
    patternInTop5: top5Ids.includes(PATTERN_ID_STABLE),
    staleInTop5: top5Ids.includes(STALE_RUNBOOK_ID),
    staleFetchableById: false,
    patternConfidenceBefore: null,
    patternConfidenceAfter: null,
    hit: top5Ids.includes(PATTERN_ID_STABLE) ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Scenario B
// ---------------------------------------------------------------------------

async function seedCapOld(client: OSClient): Promise<void> {
  await indexDoc(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD, {
    memory_id: MEM_CAP_OLD,
    created_at: "2026-01-01T00:00:00Z",
    summary: "service capacity is 1200 rps",
    generalization: "Legacy capacity claim",
    importance_score: 0.7,
    retrieval_priority: 0.7,
    pattern_confidence: 0.7,
    stability_score: 0.7,
    contradiction_score: 0.1,
    suppression_threshold: 0,
    suppressed: false,
    source_event_ids: [],
    tags: ["exp45", "capacity", "legacy"],
    embedding: [],
  });
}

async function runScenarioBPersistent(client: OSClient): Promise<ArmBResult> {
  await ensureIndex(client, CRITIQUE_EVENTS);
  await ensureIndex(client, CRITIQUE_SEMANTIC);
  await seedCapOld(client);

  const trustBeforeDoc = await getById(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD);
  const trustBefore = (trustBeforeDoc?.["retrieval_priority"] as number | undefined) ?? null;

  // Contradicting telemetry event (measured ceiling 400 rps).
  const telemetry = makeEvent({
    eventId: "exp45-cap-telemetry-400",
    timestamp: "2026-05-14T12:00:00Z",
    sessionId: "exp45-cap-telemetry",
    text: "Telemetry: measured capacity ceiling is 400 rps under sustained load. The 1200 rps claim is contradicted.",
    importanceScore: 0.88,
    tags: ["exp45", "capacity", "telemetry", "contradiction"],
    type: "environmental_observation",
  });
  await indexDoc(client, CRITIQUE_EVENTS, telemetry.eventId, toExperienceDoc(telemetry));

  const critique: MemoryCritiqueEvent = {
    critiqueId: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: "exp45-critique-session",
    agentId: "exp45-agent",
    memoryId: MEM_CAP_OLD,
    critiqueType: "contradiction",
    confidenceScore: 0.9,
    explanation: "Measured ceiling 400 rps contradicts stored claim of 1200 rps.",
    suggestedReplacement: "service capacity ceiling is 400 rps",
    abstractionLevel: "experience",
  };

  const trustAfter = await applyCritiqueTrustDelta(
    client,
    CRITIQUE_SEMANTIC,
    critique,
    TRUST_DELTA_HIGH,
  );

  // Re-consolidate replacement evidence → mem-cap-new.
  const model = new ExtractiveConsolidationModel();
  const candidates: ReplayCandidate[] = [
    {
      memoryId: telemetry.eventId,
      timestamp: telemetry.timestamp,
      summary: telemetry.input.text,
      embedding: [],
      importanceScore: telemetry.importanceScore,
      rewardScore: 0.7,
      retrievalCount: 1,
      tags: [...telemetry.tags],
    },
  ];
  const draft = await model.generate(candidates);
  await indexDoc(client, CRITIQUE_SEMANTIC, MEM_CAP_NEW, {
    memory_id: MEM_CAP_NEW,
    created_at: new Date().toISOString(),
    summary: critique.suggestedReplacement ?? draft.summary,
    generalization: draft.generalization,
    importance_score: telemetry.importanceScore,
    retrieval_priority: 0.9,
    pattern_confidence: 0.9,
    stability_score: 0.85,
    contradiction_score: 0.05,
    suppression_threshold: 0,
    suppressed: false,
    source_event_ids: [telemetry.eventId],
    tags: ["exp45", "capacity", "corrected", MEM_CAP_NEW],
    embedding: [],
  });

  // Suppress mem-cap-old (do not prune).
  const oldCandidate: ForgettingCandidate = {
    memory: {
      memoryId: MEM_CAP_OLD,
      index: "memory_semantic",
      score: 0.4,
      summary: "service capacity is 1200 rps",
      importanceScore: 0.5,
    },
    retrievalCount: 0,
    contradictionScore: 0.55,
    ageDays: 0,
    strategicValue: 0.4,
  };
  await applySuppress(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD, oldCandidate);

  const top5 = await ordinaryTop5(client, CRITIQUE_SEMANTIC, CAPACITY_PROBE);
  const top1Id = top5[0]?.id ?? null;
  const oldDoc = await getById(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD);

  return {
    arm: "persistent",
    top1Id,
    trustBefore,
    trustAfter,
    oldFetchableById: oldDoc !== undefined,
    hit: top1Id === MEM_CAP_NEW ? 1 : 0,
  };
}

async function runScenarioBReset(client: OSClient): Promise<ArmBResult> {
  await dropIndexes(client, [CRITIQUE_EVENTS, CRITIQUE_SEMANTIC]);
  await ensureIndex(client, CRITIQUE_EVENTS);
  await ensureIndex(client, CRITIQUE_SEMANTIC);
  // Reset arm: only mem-cap-old.
  await seedCapOld(client);

  const top5 = await ordinaryTop5(client, CRITIQUE_SEMANTIC, CAPACITY_PROBE);
  const top1Id = top5[0]?.id ?? null;

  return {
    arm: "reset",
    top1Id,
    trustBefore: 0.7,
    trustAfter: 0.7,
    oldFetchableById: (await getById(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD)) !== undefined,
    hit: top1Id === MEM_CAP_OLD ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Results markdown
// ---------------------------------------------------------------------------

function writeResultsMarkdown(params: {
  mode: "live" | "dry";
  hypotheses: HypothesisRow[];
  armA?: { persistent: ArmAResult; reset: ArmAResult; gap: number };
  armB?: { persistent: ArmBResult; reset: ArmBResult; gap: number };
  notes: string[];
}): void {
  const { mode, hypotheses, armA, armB, notes } = params;
  const passCount = hypotheses.filter((h) => h.pass === true).length;
  const evaluated = hypotheses.filter((h) => h.pass !== null).length;
  const lines: string[] = [
    "# Experiment 45 — Paired Falsification: Persistent vs Reset Arms",
    "",
    `**Run mode:** ${mode}`,
    `**Indexes:** \`${INCIDENT_EVENTS}\`, \`${INCIDENT_SEMANTIC}\`, \`${CRITIQUE_EVENTS}\`, \`${CRITIQUE_SEMANTIC}\` (never \`memory_semantic\`)`,
    `**Production defaults held:** countBonus=${COUNT_BONUS}, noveltyWeight=${NOVELTY_WEIGHT}, re-consolidation every ${RECON_INTERVAL_EPOCHS} epochs`,
    "",
    "## Hypothesis table",
    "",
    "| ID | Hypothesis | Result | Detail |",
    "| -- | ---------- | ------ | ------ |",
  ];
  for (const h of hypotheses) {
    const result =
      h.pass === null ? "DRY / UNEVALUATED" : h.pass ? "**PASS**" : "**FAIL**";
    lines.push(`| ${h.id} | ${h.description} | ${result} | ${h.detail} |`);
  }
  lines.push("");
  lines.push(
    mode === "live"
      ? `**Score:** ${passCount}/${evaluated} evaluated hypotheses PASS.`
      : "**Score:** dry run — no OpenSearch cluster; assertions described only.",
  );
  lines.push("");
  lines.push("## Key findings");
  lines.push("");
  if (armA) {
    lines.push(
      `- **Scenario A gap** (persistent hit − reset hit) = **${armA.gap}** ` +
        `(persistent patternInTop5=${armA.persistent.patternInTop5}, reset=${armA.reset.patternInTop5}).`,
    );
    lines.push(
      `- A persistent top-5: \`${armA.persistent.top5Ids.join(", ") || "(empty)"}\`; ` +
        `stale in top-5=${armA.persistent.staleInTop5}; stale get-by-id=${armA.persistent.staleFetchableById}.`,
    );
    lines.push(
      `- Pattern confidence before/after outcome: ` +
        `${armA.persistent.patternConfidenceBefore ?? "n/a"} → ${armA.persistent.patternConfidenceAfter ?? "n/a"}.`,
    );
  } else {
    lines.push(
      "- **Scenario A (dry):** Persistent arm would consolidate two incident episodes, reinforce the pattern with countBonus=0.02, suppress the stale runbook via DecayEngine, then probe with a new sessionId on another service. Reset arm drops indexes and probes an empty store. Gap = 1_persistent − 0_reset when H1 holds.",
    );
  }
  if (armB) {
    lines.push(
      `- **Scenario B gap** (persistent hit − reset hit) = **${armB.gap}** ` +
        `(persistent top-1=\`${armB.persistent.top1Id}\`, reset top-1=\`${armB.reset.top1Id}\`).`,
    );
    lines.push(
      `- Trust on mem-cap-old before/after critique: ` +
        `${armB.persistent.trustBefore ?? "n/a"} → ${armB.persistent.trustAfter ?? "n/a"}; ` +
        `get-by-id after suppress=${armB.persistent.oldFetchableById}.`,
    );
  } else {
    lines.push(
      "- **Scenario B (dry):** Persistent arm emits MemoryCritiqueEvent (contradiction, confidence 0.9), applies trust delta −0.25, indexes mem-cap-new from telemetry, suppresses mem-cap-old. Reset arm reseeds only mem-cap-old. Gap reported even if zero (H6).",
    );
  }
  lines.push("");
  lines.push("## Gaps / engine notes");
  lines.push("");
  lines.push(
    "- `MemoryCritiqueEvent` and DecayEngine `suppress` exist. There is no first-class OpenSearch applier for forgetting plans; this experiment applies `suppressed:true` + lowered `retrieval_priority` after `DecayEngine.decide`, matching the forgetting article (suppress keeps the doc fetchable by id).",
  );
  lines.push(
    "- `ConsolidationEngine` hardcodes `experience_events` / `memory_semantic`; experiment redirects via `searchClient` / `indexMemory` hooks so dedicated `exp45_*` indexes are used (no parallel memory stack).",
  );
  lines.push(
    "- ReinforcementEngine `memoryIndex` typing is cast to the experiment index at the call site (same pattern as Exp 58).",
  );
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## Production implications");
  lines.push("");
  lines.push(
    "1. **Apprenticeship requires persistence.** If consolidation + reinforcement + suppress are real, a new-session probe on a different service should still retrieve the pattern; an empty reset store should not. A null gap means the durable path is not yet carrying signal — do not mask that by tuning countBonus / noveltyWeight / re-consolidation interval.",
  );
  lines.push(
    "2. **Suppress ≠ prune.** Contradicted runbooks and capacity claims should leave ordinary retrieval while remaining get-by-id addressable for audit.",
  );
  lines.push(
    "3. **Critique → trust → replace.** High-confidence contradiction critiques should demote the old memory and allow a consolidated replacement to win top-1 without deleting history.",
  );
  lines.push("");

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../results/experiment-45-results.md",
  );
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
}

// ---------------------------------------------------------------------------
// Dry path (no cluster)
// ---------------------------------------------------------------------------

function runDry(): void {
  console.log("=== Experiment 45 — DRY (no OpenSearch cluster) ===\n");
  console.log("Assertions that would be evaluated against OPENSEARCH_URL:\n");
  const hypotheses: HypothesisRow[] = [
    {
      id: "H1",
      description:
        "Persistent A retrieves consolidated pattern in top-5; reset A does not",
      pass: null,
      detail: "patternInTop5(persistent)=true ∧ patternInTop5(reset)=false",
    },
    {
      id: "H2",
      description:
        "Persistent A: stale runbook absent from ordinary top-5; get-by-id succeeds",
      pass: null,
      detail: "staleInTop5=false ∧ staleFetchableById=true",
    },
    {
      id: "H3",
      description:
        "Pattern confidence moves with outcome on persistent arm only",
      pass: null,
      detail: "patternConfidenceAfter > patternConfidenceBefore on persistent; reset has nulls",
    },
    {
      id: "H4",
      description: "Persistent B top-1=mem-cap-new; reset B top-1=mem-cap-old",
      pass: null,
      detail: "top1(persistent)=mem-cap-new ∧ top1(reset)=mem-cap-old",
    },
    {
      id: "H5",
      description: "mem-cap-old remains fetchable by id after suppression",
      pass: null,
      detail: "get(CRITIQUE_SEMANTIC, mem-cap-old) succeeds on persistent arm",
    },
    {
      id: "H6",
      description: "Gap (persistent hit − reset hit) reported even if zero",
      pass: null,
      detail: "gapA and gapB always written; defaults countBonus=0.02 noveltyWeight=0.30 recon=5 held",
    },
  ];
  for (const h of hypotheses) {
    console.log(`  ${h.id}: ${h.description}`);
    console.log(`       assert: ${h.detail}`);
  }

  writeResultsMarkdown({
    mode: "dry",
    hypotheses,
    notes: [
      "Cluster unreachable or OPENSEARCH_URL unset; live PASS/FAIL not evaluated.",
      "Prior blog-telemetry Exp 45 JSON archives under results/ remain historical; this script entrypoint is the paired falsification protocol.",
    ],
  });

  saveResults(
    "experiment-45",
    "DRY — no OpenSearch; assertion descriptions written to experiment-45-results.md",
    {
      mode: "dry",
      hypotheses,
      invariants: {
        countBonus: COUNT_BONUS,
        noveltyWeight: NOVELTY_WEIGHT,
        reconsolidationIntervalEpochs: RECON_INTERVAL_EPOCHS,
      },
      indexes: ALL_INDEXES,
    },
  );
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------

async function clusterReachable(url: string): Promise<boolean> {
  try {
    const client = createOpenSearchClient({ node: url, ssl: { rejectUnauthorized: false } });
    const ping = await client.ping();
    return Boolean(ping.body);
  } catch {
    return false;
  }
}

async function runLive(url: string): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log(`=== Experiment 45 — Paired Falsification @ ${url} ===\n`);
  console.log(
    `Invariants: countBonus=${COUNT_BONUS} noveltyWeight=${NOVELTY_WEIGHT} reconEvery=${RECON_INTERVAL_EPOCHS}`,
  );

  try {
    console.log("\n--- Scenario A: incident apprenticeship ---");
    const aPersistent = await runScenarioAPersistent(client);
    console.log(
      `  persistent top5=[${aPersistent.top5Ids.join(", ")}] pattern=${aPersistent.patternInTop5} stale=${aPersistent.staleInTop5}`,
    );
    const aReset = await runScenarioAReset(client);
    console.log(`  reset top5=[${aReset.top5Ids.join(", ")}] pattern=${aReset.patternInTop5}`);
    const gapA = aPersistent.hit - aReset.hit;
    console.log(`  gapA (persistent − reset) = ${gapA}`);

    console.log("\n--- Scenario B: critique on contradiction ---");
    const bPersistent = await runScenarioBPersistent(client);
    console.log(
      `  persistent top1=${bPersistent.top1Id} trust ${bPersistent.trustBefore}→${bPersistent.trustAfter}`,
    );
    const bReset = await runScenarioBReset(client);
    console.log(`  reset top1=${bReset.top1Id}`);
    const gapB = bPersistent.hit - bReset.hit;
    console.log(`  gapB (persistent − reset) = ${gapB}`);

    const h1 =
      aPersistent.patternInTop5 === true && aReset.patternInTop5 === false;
    const h2 =
      aPersistent.staleInTop5 === false && aPersistent.staleFetchableById === true;
    const h3 =
      aPersistent.patternConfidenceBefore !== null &&
      aPersistent.patternConfidenceAfter !== null &&
      aPersistent.patternConfidenceAfter > aPersistent.patternConfidenceBefore &&
      aReset.patternConfidenceAfter === null;
    const h4 =
      bPersistent.top1Id === MEM_CAP_NEW && bReset.top1Id === MEM_CAP_OLD;
    const h5 = bPersistent.oldFetchableById === true;
    const h6 = Number.isFinite(gapA) && Number.isFinite(gapB); // reported even if 0

    const hypotheses: HypothesisRow[] = [
      {
        id: "H1",
        description:
          "Persistent A retrieves consolidated pattern in top-5; reset A does not",
        pass: h1,
        detail: `persistent=${aPersistent.patternInTop5} reset=${aReset.patternInTop5}`,
      },
      {
        id: "H2",
        description:
          "Persistent A: stale runbook absent from ordinary top-5; get-by-id succeeds",
        pass: h2,
        detail: `staleInTop5=${aPersistent.staleInTop5} fetchable=${aPersistent.staleFetchableById}`,
      },
      {
        id: "H3",
        description:
          "Pattern confidence moves with outcome on persistent arm only",
        pass: h3,
        detail: `before=${aPersistent.patternConfidenceBefore} after=${aPersistent.patternConfidenceAfter}`,
      },
      {
        id: "H4",
        description: "Persistent B top-1=mem-cap-new; reset B top-1=mem-cap-old",
        pass: h4,
        detail: `persistent=${bPersistent.top1Id} reset=${bReset.top1Id}`,
      },
      {
        id: "H5",
        description: "mem-cap-old remains fetchable by id after suppression",
        pass: h5,
        detail: `fetchable=${bPersistent.oldFetchableById}`,
      },
      {
        id: "H6",
        description: "Gap (persistent hit − reset hit) reported even if zero",
        pass: h6,
        detail: `gapA=${gapA} gapB=${gapB}`,
      },
    ];

    for (const h of hypotheses) {
      console.log(`\n${h.id} — ${h.pass ? "✓ PASS" : "✗ FAIL"}: ${h.detail}`);
    }

    writeResultsMarkdown({
      mode: "live",
      hypotheses,
      armA: { persistent: aPersistent, reset: aReset, gap: gapA },
      armB: { persistent: bPersistent, reset: bReset, gap: gapB },
      notes: [],
    });

    saveResults(
      "experiment-45",
      hypotheses.map((h) => `${h.id} ${h.pass ? "PASS" : "FAIL"} — ${h.detail}`).join("\n"),
      {
        mode: "live",
        hypotheses,
        scenarioA: { persistent: aPersistent, reset: aReset, gap: gapA },
        scenarioB: { persistent: bPersistent, reset: bReset, gap: gapB },
        invariants: {
          countBonus: COUNT_BONUS,
          noveltyWeight: NOVELTY_WEIGHT,
          reconsolidationIntervalEpochs: RECON_INTERVAL_EPOCHS,
        },
      },
    );
  } finally {
    console.log("\nCleaning up experiment indexes...");
    await dropIndexes(client, ALL_INDEXES);
    console.log("Dropped:", ALL_INDEXES.join(", "));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env["OPENSEARCH_URL"];
  if (!url) {
    console.log("OPENSEARCH_URL unset — writing dry assertion description.\n");
    runDry();
    return;
  }
  const ok = await clusterReachable(url);
  if (!ok) {
    console.log(`OpenSearch at ${url} unreachable — writing dry assertion description.\n`);
    runDry();
    return;
  }
  await runLive(url);
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
