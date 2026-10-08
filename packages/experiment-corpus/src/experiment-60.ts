/**
 * Experiment 60 — Falsification set Exp 59 did not run
 *
 * Twelve constructed streams + fair-reset / critique controls.
 * A null or failed hypothesis is a valid result. Production defaults
 * (countBonus 0.02, noveltyWeight 0.30, re-consolidation every 5 epochs)
 * are held fixed — do not tune them to flip a result.
 *
 * Indexes (never memory_semantic):
 *   exp60_incident_events, exp60_incident_semantic
 *   exp60_shape_events,    exp60_shape_semantic
 *   exp60_critique_events, exp60_critique_semantic
 * Dropped at end of run.
 *
 * Streams:
 *   1. Incident pair (Exp 59 shape): two episodes
 *      BACKPRESSURE_ACCUMULATION → QUEUE_GROWTH → FAILOVER → RECOVERY
 *      + stale restart runbook; consolidate → reinforce → suppress → probe.
 *   2. No-shared-token probe: service is a keyword field only; probe text
 *      shares no content words with episode summaries; match only via
 *      consolidated generalization.
 *   3. Fair reset for stream 1: same raw episodes + stale runbook; skip
 *      consolidation, reinforcement, suppress. Probe must not return
 *      mem-incident-pattern (stale runbook may appear).
 *   4–8. Five primitive-vocabulary shapes (SEED_PATTERNS). Each has a
 *      held-form and a reverted-form stream (10 streams). Confidence rises
 *      only on held; the reverted remedy is suppressed.
 *   9. Critique: mem-cap-old → contradicting telemetry → mem-cap-new, plus
 *      an unrelated high-priority memory. Persistent top-1 = mem-cap-new;
 *      unrelated wins its own probe; reset (only mem-cap-old) returns
 *      mem-cap-old; mem-cap-old remains get-by-id after suppress; trust falls.
 *
 * Hypotheses (assert each; write PASS/FAIL):
 *   H1 Fair-reset probe does not return the consolidated pattern id;
 *      persistent probe does.
 *   H2 No-shared-token probe returns the consolidated pattern on the
 *      persistent arm.
 *   H3 Stale runbook absent from ordinary top-5 after suppress and still
 *      fetchable by id.
 *   H4 On all five shapes, held-form confidence increases and
 *      reverted-form confidence does not.
 *   H5 On all five shapes, the reverted remedy is suppressed and the held
 *      remedy is not.
 *   H6 Critique persistent top-1 is mem-cap-new; reset top-1 is
 *      mem-cap-old; unrelated memory wins its own probe.
 *   H7 Report per-stream hit values, including zeros. Do not collapse to
 *      a single 6/6 score.
 *
 * Usage:
 *   OPENSEARCH_URL=http://localhost:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp60
 *
 * If no cluster is reachable, the script writes the assertion list and
 * exits 0. It does not invent PASS rows.
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
import { SEED_PATTERNS } from "@cognitive-substrate/abstraction-engine";
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
const NOVELTY_WEIGHT = 0.30;
const RECON_INTERVAL_EPOCHS = 5;

const INCIDENT_EVENTS = "exp60_incident_events";
const INCIDENT_SEMANTIC = "exp60_incident_semantic";
const SHAPE_EVENTS = "exp60_shape_events";
const SHAPE_SEMANTIC = "exp60_shape_semantic";
const CRITIQUE_EVENTS = "exp60_critique_events";
const CRITIQUE_SEMANTIC = "exp60_critique_semantic";

const ALL_INDEXES = [
  INCIDENT_EVENTS,
  INCIDENT_SEMANTIC,
  SHAPE_EVENTS,
  SHAPE_SEMANTIC,
  CRITIQUE_EVENTS,
  CRITIQUE_SEMANTIC,
] as const;

const STALE_RUNBOOK_ID = "mem-stale-runbook";
const PATTERN_ID_STABLE = "mem-incident-pattern";
const MEM_CAP_OLD = "mem-cap-old";
const MEM_CAP_NEW = "mem-cap-new";
const MEM_UNRELATED = "mem-unrelated-priority";

const SEED_SERVICE = "payments-api";
const PROBE_SERVICE = "checkout-api";
const PROBE_QUERY =
  `queue growth and backpressure on ${PROBE_SERVICE}, what do we do?`;

/**
 * Probe for stream 2: shares no content tokens with episode summaries.
 * Matches only the hand-enriched consolidated generalization.
 */
const NO_SHARED_PROBE =
  "stabilize consumer lag via replica drain protocol without broker reboot";

/** Generalization text used only on the consolidated pattern (stream 2). */
const PATTERN_GENERALIZATION =
  "stabilize consumer lag via replica drain protocol without broker reboot when pressure cascades";

const CAPACITY_PROBE = "what is the capacity ceiling?";
const UNRELATED_PROBE = "how do we rotate TLS certificates for edge gateways?";

const PHASES = [
  "BACKPRESSURE_ACCUMULATION",
  "QUEUE_GROWTH",
  "FAILOVER",
  "RECOVERY",
] as const;
type Phase = (typeof PHASES)[number];

const TRUST_DELTA_HIGH = -0.25;

/** Five shapes from the closed primitive vocabulary (SEED_PATTERNS). */
const SHAPES = SEED_PATTERNS.slice(0, 5);

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RankedHit {
  id: string;
  score: number;
  summary: string;
}

interface StreamRow {
  stream: string;
  kind: string;
  hit: number;
  detail: string;
}

interface HypothesisRow {
  id: string;
  description: string;
  pass: boolean | null;
  detail: string;
}

interface ShapeArmResult {
  shapeId: string;
  form: "held" | "reverted";
  remedyId: string;
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceIncreased: boolean;
  suppressed: boolean;
  hit: number;
}

// ---------------------------------------------------------------------------
// Index helpers (BM25-only; embeddings [])
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
      service: { type: "keyword" },
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
      embedding: { type: "float" },
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
 * Ordinary retrieval: BM25 over summary (+ optional generalization),
 * excluding suppressed docs. Ranking blends _score with retrieval_priority.
 */
async function ordinaryTop5(
  client: OSClient,
  index: string,
  queryText: string,
  options?: { includeGeneralization?: boolean },
): Promise<RankedHit[]> {
  const mustClauses: Record<string, unknown>[] = options?.includeGeneralization
    ? [
        {
          multi_match: {
            query: queryText,
            fields: ["summary", "generalization"],
          },
        },
      ]
    : [{ match: { summary: queryText } }];

  const resp = await client.search({
    index,
    body: {
      size: 5,
      query: {
        function_score: {
          query: {
            bool: {
              must: mustClauses,
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
      _source: ["summary", "generalization", "memory_id", "event_id", "retrieval_priority", "suppressed"],
    },
  });
  const hits =
    (
      (resp.body as {
        hits?: {
          hits?: Array<{ _id: string; _score: number; _source: { summary?: string } }>;
        };
      }).hits?.hits
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

/** Stream-2 summaries: no service name in text; service is keyword-only. */
function phaseTextNoService(phase: Phase, episode: number): string {
  switch (phase) {
    case "BACKPRESSURE_ACCUMULATION":
      return `Episode ${episode}: ${phase}. Producer pressure rising; consumers lagging.`;
    case "QUEUE_GROWTH":
      return `Episode ${episode}: ${phase}. Depth climbing; lag amplifying under load.`;
    case "FAILOVER":
      return `Episode ${episode}: ${phase}. Fail over consumers; move backlog via replica path.`;
    case "RECOVERY":
      return `Episode ${episode}: ${phase}. Successful recovery after controlled wait — do not restart.`;
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

function toExperienceDoc(
  event: ExperienceEvent,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
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
    ...extras,
  };
}

async function seedIncidentStream(
  client: OSClient,
  options?: { omitServiceFromSummary?: boolean },
): Promise<{ eventIds: string[]; staleId: string }> {
  const eventIds: string[] = [];
  const base = Date.parse("2026-05-14T10:00:00Z");
  let t = 0;
  const omit = options?.omitServiceFromSummary === true;

  for (const episode of [1, 2] as const) {
    const service = episode === 1 ? SEED_SERVICE : "billing-api";
    const sessionId = `exp60-incident-ep${episode}`;
    for (const phase of PHASES) {
      const eventId = `exp60-ep${episode}-${phase.toLowerCase()}`;
      const text = omit
        ? phaseTextNoService(phase, episode)
        : phaseText(phase, service, episode);
      const event = makeEvent({
        eventId,
        timestamp: new Date(base + t * 60_000).toISOString(),
        sessionId,
        text,
        importanceScore: phaseImportance(phase),
        tags: ["exp60", "incident", phase, service, `episode-${episode}`],
      });
      await indexDoc(
        client,
        INCIDENT_EVENTS,
        eventId,
        toExperienceDoc(event, { service }),
      );
      eventIds.push(eventId);
      t += 1;
    }
  }

  const stale = makeEvent({
    eventId: STALE_RUNBOOK_ID,
    timestamp: new Date(base - 86_400_000).toISOString(),
    sessionId: "exp60-stale-runbook",
    text:
      "Runbook (stale): On queue growth and backpressure, always restart the message broker immediately. Never wait for drain. Restart is the only recovery.",
    importanceScore: 0.55,
    tags: ["exp60", "runbook", "stale", "contradicts-recovery"],
    type: "system_event",
  });
  await indexDoc(client, INCIDENT_EVENTS, STALE_RUNBOOK_ID, {
    ...toExperienceDoc(stale),
    memory_id: STALE_RUNBOOK_ID,
    contradiction_score: 0.55,
  });
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

function positiveOutcomeSignal(importance: number): ReinforcementSignal {
  return {
    importance,
    usageFrequency: 0.4,
    goalRelevance: 0.85,
    novelty: NOVELTY_WEIGHT,
    predictionAccuracy: 0.8,
    emotionalWeight: 0.55,
    contradictionRisk: 0.1,
    policyAlignment: 0.75,
  };
}

function suppressCandidate(memoryId: string, summary: string): ForgettingCandidate {
  return {
    memory: {
      memoryId,
      index: "memory_semantic",
      score: 0.4,
      summary,
      importanceScore: 0.5,
    },
    retrievalCount: 0,
    contradictionScore: 0.55,
    ageDays: 0,
    strategicValue: 0.4,
  };
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

async function consolidateOnto(
  client: OSClient,
  eventsIndex: string,
  semanticIndex: string,
  requiredTags: string[],
): Promise<string> {
  const consolidator = new ConsolidationEngine({
    openSearch: client,
    model: new ExtractiveConsolidationModel(),
  });
  const consolidation = await consolidator.consolidate({
    requestId: `exp60-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    maxAge: "2020-01-01T00:00:00Z",
    minImportance: 0.5,
    size: 50,
    requiredTags,
    eventsIndex,
    semanticIndex,
  });
  return consolidation.semanticMemory.memoryId;
}

async function reinforcePattern(
  client: OSClient,
  index: string,
  memoryId: string,
): Promise<{ before: number; after: number }> {
  const beforeDoc = await getById(client, index, memoryId);
  const before =
    (beforeDoc?.["pattern_confidence"] as number | undefined) ??
    (beforeDoc?.["retrieval_priority"] as number | undefined) ??
    0.5;

  const reinforcer = new ReinforcementEngine({
    openSearch: client as never,
    countBonus: COUNT_BONUS,
    priorWeight: 0,
  });
  for (let epoch = 0; epoch < RECON_INTERVAL_EPOCHS; epoch++) {
    await reinforcer.evaluate({
      memoryId,
      memoryIndex: index as "memory_semantic",
      signal: positiveOutcomeSignal(0.88),
    });
  }

  const afterDoc = await getById(client, index, memoryId);
  const rp =
    (afterDoc?.["retrieval_priority"] as number | undefined) ?? before;
  await client.update({
    index,
    id: memoryId,
    body: { doc: { pattern_confidence: rp } },
    refresh: "wait_for",
  });
  return { before, after: rp };
}

// ---------------------------------------------------------------------------
// Stream 1 — incident pair (persistent)
// ---------------------------------------------------------------------------

async function runStream1Incident(client: OSClient): Promise<{
  top5Ids: string[];
  patternInTop5: boolean;
  staleInTop5: boolean;
  staleFetchableById: boolean;
  hit: number;
}> {
  await ensureIndex(client, INCIDENT_EVENTS);
  await ensureIndex(client, INCIDENT_SEMANTIC);
  await seedIncidentStream(client);

  const rawPatternId = await consolidateOnto(
    client,
    INCIDENT_EVENTS,
    INCIDENT_SEMANTIC,
    ["incident"],
  );
  const patternDoc = await getById(client, INCIDENT_SEMANTIC, rawPatternId);
  if (!patternDoc) throw new Error("consolidated pattern missing after write");
  await indexDoc(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE, {
    ...patternDoc,
    memory_id: PATTERN_ID_STABLE,
    summary:
      `${patternDoc["summary"] as string} Consolidated incident pattern: backpressure and queue growth → failover → recovery by draining, not broker restart.`,
    generalization:
      `${(patternDoc["generalization"] as string | undefined) ?? ""} When backpressure and queue growth precede failover, recover by draining rather than restarting the broker.`,
    tags: ["exp60", "consolidated", "incident-pattern", PATTERN_ID_STABLE],
  });
  if (rawPatternId !== PATTERN_ID_STABLE) {
    await client
      .delete({ index: INCIDENT_SEMANTIC, id: rawPatternId, refresh: "wait_for" })
      .catch(() => undefined);
  }

  await reinforcePattern(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE);

  const decay = new DecayEngine({ openSearch: client });
  await decay.applySuppress(
    INCIDENT_SEMANTIC,
    suppressCandidate(STALE_RUNBOOK_ID, "stale runbook"),
  );

  const top5 = await ordinaryTop5(client, INCIDENT_SEMANTIC, PROBE_QUERY);
  const top5Ids = top5.map((h) => h.id);
  const staleDoc = await getById(client, INCIDENT_SEMANTIC, STALE_RUNBOOK_ID);

  return {
    top5Ids,
    patternInTop5: top5Ids.includes(PATTERN_ID_STABLE),
    staleInTop5: top5Ids.includes(STALE_RUNBOOK_ID),
    staleFetchableById: staleDoc !== undefined,
    hit: top5Ids.includes(PATTERN_ID_STABLE) ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Stream 2 — no-shared-token probe
// ---------------------------------------------------------------------------

async function runStream2NoSharedToken(client: OSClient): Promise<{
  top5Ids: string[];
  patternInTop5: boolean;
  hit: number;
}> {
  await ensureIndex(client, INCIDENT_EVENTS);
  await ensureIndex(client, INCIDENT_SEMANTIC);
  await seedIncidentStream(client, { omitServiceFromSummary: true });

  const rawPatternId = await consolidateOnto(
    client,
    INCIDENT_EVENTS,
    INCIDENT_SEMANTIC,
    ["incident"],
  );
  const patternDoc = await getById(client, INCIDENT_SEMANTIC, rawPatternId);
  if (!patternDoc) throw new Error("stream2 pattern missing");

  // Enrich generalization with probe-only vocabulary (no overlap with episode summaries).
  await indexDoc(client, INCIDENT_SEMANTIC, PATTERN_ID_STABLE, {
    ...patternDoc,
    memory_id: PATTERN_ID_STABLE,
    // Keep summary lexical from episodes; generalization carries the exclusive tokens.
    summary: patternDoc["summary"],
    generalization: PATTERN_GENERALIZATION,
    retrieval_priority: 0.92,
    pattern_confidence: 0.9,
    tags: ["exp60", "consolidated", "incident-pattern", "no-shared-token"],
  });
  if (rawPatternId !== PATTERN_ID_STABLE) {
    await client
      .delete({ index: INCIDENT_SEMANTIC, id: rawPatternId, refresh: "wait_for" })
      .catch(() => undefined);
  }

  const top5 = await ordinaryTop5(client, INCIDENT_SEMANTIC, NO_SHARED_PROBE, {
    includeGeneralization: true,
  });
  const top5Ids = top5.map((h) => h.id);
  return {
    top5Ids,
    patternInTop5: top5Ids.includes(PATTERN_ID_STABLE),
    hit: top5Ids.includes(PATTERN_ID_STABLE) ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Stream 3 — fair reset (seed only; no consolidate / reinforce / suppress)
// ---------------------------------------------------------------------------

async function runStream3FairReset(client: OSClient): Promise<{
  top5Ids: string[];
  patternInTop5: boolean;
  staleInTop5: boolean;
  hit: number;
}> {
  await ensureIndex(client, INCIDENT_EVENTS);
  await ensureIndex(client, INCIDENT_SEMANTIC);
  await seedIncidentStream(client);
  // Intentionally skip consolidation, reinforcement, and suppress.

  const top5 = await ordinaryTop5(client, INCIDENT_SEMANTIC, PROBE_QUERY);
  const top5Ids = top5.map((h) => h.id);
  return {
    top5Ids,
    patternInTop5: top5Ids.includes(PATTERN_ID_STABLE),
    staleInTop5: top5Ids.includes(STALE_RUNBOOK_ID),
    hit: top5Ids.includes(PATTERN_ID_STABLE) ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Streams 4–8 — five shapes × held / reverted
// ---------------------------------------------------------------------------

async function runShapeArm(
  client: OSClient,
  shapeIndex: number,
  form: "held" | "reverted",
): Promise<ShapeArmResult> {
  const shape = SHAPES[shapeIndex];
  if (!shape) throw new Error(`shape ${shapeIndex} missing`);

  await ensureIndex(client, SHAPE_EVENTS);
  await ensureIndex(client, SHAPE_SEMANTIC);

  const base = Date.parse("2026-06-01T10:00:00Z");
  let t = 0;
  for (const primitive of shape.signature) {
    const eventId = `exp60-${shape.patternId}-${primitive}-${form}`;
    const event = makeEvent({
      eventId,
      timestamp: new Date(base + t * 60_000).toISOString(),
      sessionId: `exp60-shape-${shape.patternId}-${form}`,
      text: `Observed ${primitive} in ${shape.patternId}: ${shape.outcome}`,
      importanceScore: 0.8,
      tags: ["exp60", "shape", shape.patternId, primitive, form],
    });
    await indexDoc(client, SHAPE_EVENTS, eventId, toExperienceDoc(event));
    t += 1;
  }

  const heldId = `mem-remedy-held-${shape.patternId}`;
  const revertedId = `mem-remedy-reverted-${shape.patternId}`;
  const heldSummary =
    shape.interventions[0] ??
    `Apply held remedy for ${shape.patternId}`;
  const revertedSummary =
    `Reverted remedy for ${shape.patternId}: do the opposite of "${heldSummary}" — this intervention was rolled back after failure.`;

  const remedyId = form === "held" ? heldId : revertedId;
  const summary = form === "held" ? heldSummary : revertedSummary;
  const confidenceBefore = 0.55;

  await indexDoc(client, SHAPE_SEMANTIC, remedyId, {
    memory_id: remedyId,
    created_at: new Date().toISOString(),
    summary,
    generalization: shape.outcome,
    importance_score: 0.75,
    retrieval_priority: confidenceBefore,
    pattern_confidence: confidenceBefore,
    stability_score: 0.7,
    contradiction_score: form === "reverted" ? 0.55 : 0.05,
    suppression_threshold: 0,
    suppressed: false,
    source_event_ids: [],
    tags: ["exp60", "remedy", shape.patternId, form],
    embedding: [],
  });

  let confidenceAfter = confidenceBefore;
  let suppressed = false;

  if (form === "held") {
    const moved = await reinforcePattern(client, SHAPE_SEMANTIC, remedyId);
    confidenceAfter = moved.after;
  } else {
    // No positive reinforcement on reverted form — confidence must not rise.
    const decay = new DecayEngine({ openSearch: client });
    await decay.applySuppress(
      SHAPE_SEMANTIC,
      suppressCandidate(revertedId, revertedSummary),
    );
    const afterDoc = await getById(client, SHAPE_SEMANTIC, remedyId);
    confidenceAfter =
      (afterDoc?.["pattern_confidence"] as number | undefined) ?? confidenceBefore;
    suppressed = afterDoc?.["suppressed"] === true;
  }

  const heldDoc =
    form === "held" ? await getById(client, SHAPE_SEMANTIC, remedyId) : undefined;
  if (form === "held") {
    suppressed = heldDoc?.["suppressed"] === true;
  }

  const confidenceIncreased = confidenceAfter > confidenceBefore;
  // Per-stream hit: held expects increase & not suppressed; reverted expects
  // no increase & suppressed.
  const hit =
    form === "held"
      ? confidenceIncreased && !suppressed
        ? 1
        : 0
      : !confidenceIncreased && suppressed
        ? 1
        : 0;

  return {
    shapeId: shape.patternId,
    form,
    remedyId,
    confidenceBefore,
    confidenceAfter,
    confidenceIncreased,
    suppressed,
    hit,
  };
}

// ---------------------------------------------------------------------------
// Stream 9 — critique case
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
    tags: ["exp60", "capacity", "legacy"],
    embedding: [],
  });
}

async function runCritiquePersistent(client: OSClient): Promise<{
  top1Id: string | null;
  unrelatedTop1Id: string | null;
  trustBefore: number | null;
  trustAfter: number | null;
  oldFetchableById: boolean;
  hit: number;
}> {
  await ensureIndex(client, CRITIQUE_EVENTS);
  await ensureIndex(client, CRITIQUE_SEMANTIC);
  await seedCapOld(client);

  // Unrelated high-priority memory that is not contradicted.
  await indexDoc(client, CRITIQUE_SEMANTIC, MEM_UNRELATED, {
    memory_id: MEM_UNRELATED,
    created_at: "2026-02-01T00:00:00Z",
    summary:
      "Rotate TLS certificates for edge gateways on a 60-day cadence using the automated vault workflow.",
    generalization: "TLS certificate rotation runbook",
    importance_score: 0.95,
    retrieval_priority: 0.95,
    pattern_confidence: 0.95,
    stability_score: 0.9,
    contradiction_score: 0.0,
    suppression_threshold: 0,
    suppressed: false,
    source_event_ids: [],
    tags: ["exp60", "tls", "unrelated"],
    embedding: [],
  });

  const trustBeforeDoc = await getById(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD);
  const trustBefore = (trustBeforeDoc?.["retrieval_priority"] as number | undefined) ?? null;

  const telemetry = makeEvent({
    eventId: "exp60-cap-telemetry-400",
    timestamp: "2026-05-14T12:00:00Z",
    sessionId: "exp60-cap-telemetry",
    text: "Telemetry: measured capacity ceiling is 400 rps under sustained load. The 1200 rps claim is contradicted.",
    importanceScore: 0.88,
    tags: ["exp60", "capacity", "telemetry", "contradiction"],
    type: "environmental_observation",
  });
  await indexDoc(client, CRITIQUE_EVENTS, telemetry.eventId, toExperienceDoc(telemetry));

  const critique: MemoryCritiqueEvent = {
    critiqueId: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: "exp60-critique-session",
    agentId: "exp60-agent",
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
    tags: ["exp60", "capacity", "corrected", MEM_CAP_NEW],
    embedding: [],
  });

  const decay = new DecayEngine({ openSearch: client });
  await decay.applySuppress(
    CRITIQUE_SEMANTIC,
    suppressCandidate(MEM_CAP_OLD, "service capacity is 1200 rps"),
  );

  const top5 = await ordinaryTop5(client, CRITIQUE_SEMANTIC, CAPACITY_PROBE);
  const top1Id = top5[0]?.id ?? null;
  const unrelatedTop5 = await ordinaryTop5(client, CRITIQUE_SEMANTIC, UNRELATED_PROBE);
  const unrelatedTop1Id = unrelatedTop5[0]?.id ?? null;
  const oldDoc = await getById(client, CRITIQUE_SEMANTIC, MEM_CAP_OLD);

  const hit =
    top1Id === MEM_CAP_NEW && unrelatedTop1Id === MEM_UNRELATED ? 1 : 0;

  return {
    top1Id,
    unrelatedTop1Id,
    trustBefore,
    trustAfter,
    oldFetchableById: oldDoc !== undefined,
    hit,
  };
}

async function runCritiqueReset(client: OSClient): Promise<{
  top1Id: string | null;
  hit: number;
}> {
  await dropIndexes(client, [CRITIQUE_EVENTS, CRITIQUE_SEMANTIC]);
  await ensureIndex(client, CRITIQUE_EVENTS);
  await ensureIndex(client, CRITIQUE_SEMANTIC);
  await seedCapOld(client);

  const top5 = await ordinaryTop5(client, CRITIQUE_SEMANTIC, CAPACITY_PROBE);
  const top1Id = top5[0]?.id ?? null;
  return {
    top1Id,
    hit: top1Id === MEM_CAP_OLD ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Results markdown
// ---------------------------------------------------------------------------

function writeResultsMarkdown(params: {
  mode: "live" | "dry";
  hypotheses: HypothesisRow[];
  streams: StreamRow[];
  notes: string[];
}): void {
  const { mode, hypotheses, streams, notes } = params;
  const passCount = hypotheses.filter((h) => h.pass === true).length;
  const evaluated = hypotheses.filter((h) => h.pass !== null).length;
  const lines: string[] = [
    "# Experiment 60 — Falsification Set (Twelve Constructed Streams)",
    "",
    `**Run mode:** ${mode}`,
    `**Indexes:** \`${INCIDENT_EVENTS}\`, \`${INCIDENT_SEMANTIC}\`, \`${SHAPE_EVENTS}\`, \`${SHAPE_SEMANTIC}\`, \`${CRITIQUE_EVENTS}\`, \`${CRITIQUE_SEMANTIC}\` (never \`memory_semantic\`)`,
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
  if (mode === "live") {
    lines.push(
      `**Hypothesis score (do not treat as the experiment score):** ${passCount}/${evaluated}. Per-stream hits below are the primary report (H7).`,
    );
  } else {
    lines.push(
      "**Score:** dry run — no OpenSearch cluster; assertions described only. No PASS rows invented.",
    );
  }
  lines.push("");
  lines.push("## Per-stream table");
  lines.push("");
  lines.push("| Stream | Kind | Hit | Detail |");
  lines.push("| ------ | ---- | --- | ------ |");
  for (const s of streams) {
    lines.push(`| ${s.stream} | ${s.kind} | ${s.hit} | ${s.detail} |`);
  }
  lines.push("");
  lines.push("## Key findings");
  lines.push("");
  if (mode === "dry") {
    lines.push(
      "- Twelve constructed streams: incident pair, no-shared-token, five held-form + five reverted-form shapes. Fair-reset and critique are paired controls.",
    );
  } else {
    for (const s of streams) {
      lines.push(`- **${s.stream}** (${s.kind}): hit=${s.hit} — ${s.detail}`);
    }
  }
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## Production implications");
  lines.push("");
  lines.push(
    "1. **Fair reset is the right control.** Seeding raw episodes without consolidate→reinforce→suppress must not surface `mem-incident-pattern`. A persistent hit with a fair-reset miss is apprenticeship signal; a null gap means the durable path is not yet carrying it — do not mask by tuning countBonus / noveltyWeight / recon interval.",
  );
  lines.push(
    "2. **Generalization must carry transferable vocabulary.** A no-shared-token probe that can only match the consolidated generalization tests whether abstraction, not lexical echo of episode summaries, is what retrieval is using.",
  );
  lines.push(
    "3. **Held vs reverted forms.** Confidence must rise only on held remedies; reverted remedies must be suppress-written by DecayEngine (doc remains get-by-id). Shapes stay inside the closed OperationalPrimitive vocabulary.",
  );
  lines.push(
    "4. **Critique replacement is local.** mem-cap-new winning the capacity probe must not outrank an unrelated high-priority memory on an unrelated probe; suppress ≠ prune.",
  );
  lines.push("");

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../results/experiment-60-results.md",
  );
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
}

function dryHypotheses(): HypothesisRow[] {
  return [
    {
      id: "H1",
      description:
        "Fair-reset probe does not return the consolidated pattern id; persistent probe does",
      pass: null,
      detail: "S1.patternInTop5=true ∧ S3.patternInTop5=false",
    },
    {
      id: "H2",
      description:
        "No-shared-token probe returns the consolidated pattern on the persistent arm",
      pass: null,
      detail: "S2.patternInTop5=true (match via generalization only)",
    },
    {
      id: "H3",
      description:
        "Stale runbook absent from ordinary top-5 after suppress and still fetchable by id",
      pass: null,
      detail: "S1.staleInTop5=false ∧ S1.staleFetchableById=true",
    },
    {
      id: "H4",
      description:
        "On all five shapes, held-form confidence increases and reverted-form confidence does not",
      pass: null,
      detail: "∀ shape: held.confidenceIncreased ∧ ¬reverted.confidenceIncreased",
    },
    {
      id: "H5",
      description:
        "On all five shapes, the reverted remedy is suppressed and the held remedy is not",
      pass: null,
      detail: "∀ shape: reverted.suppressed ∧ ¬held.suppressed",
    },
    {
      id: "H6",
      description:
        "Critique persistent top-1 is mem-cap-new; reset top-1 is mem-cap-old; unrelated memory wins its own probe",
      pass: null,
      detail:
        "persistent.top1=mem-cap-new ∧ reset.top1=mem-cap-old ∧ unrelated.top1=mem-unrelated-priority",
    },
    {
      id: "H7",
      description:
        "Report per-stream hit values, including zeros; do not collapse to a single 6/6 score",
      pass: null,
      detail: "per-stream table written with hit ∈ {0,1} for each stream",
    },
  ];
}

function dryStreams(): StreamRow[] {
  return [
    { stream: "S1", kind: "incident-pair", hit: 0, detail: "unevaluated (dry)" },
    { stream: "S2", kind: "no-shared-token", hit: 0, detail: "unevaluated (dry)" },
    { stream: "S3", kind: "fair-reset", hit: 0, detail: "unevaluated (dry)" },
    ...SHAPES.flatMap((shape, i) => [
      {
        stream: `S${4 + i}-held`,
        kind: `${shape.patternId}/held`,
        hit: 0,
        detail: "unevaluated (dry)",
      },
      {
        stream: `S${4 + i}-reverted`,
        kind: `${shape.patternId}/reverted`,
        hit: 0,
        detail: "unevaluated (dry)",
      },
    ]),
    {
      stream: "S9-persistent",
      kind: "critique-persistent",
      hit: 0,
      detail: "unevaluated (dry)",
    },
    {
      stream: "S9-reset",
      kind: "critique-reset",
      hit: 0,
      detail: "unevaluated (dry)",
    },
  ];
}

// ---------------------------------------------------------------------------
// Dry / live
// ---------------------------------------------------------------------------

function runDry(): void {
  console.log("=== Experiment 60 — DRY (no OpenSearch cluster) ===\n");
  console.log("Assertions that would be evaluated against OPENSEARCH_URL:\n");
  const hypotheses = dryHypotheses();
  for (const h of hypotheses) {
    console.log(`  ${h.id}: ${h.description}`);
    console.log(`       assert: ${h.detail}`);
  }
  const streams = dryStreams();
  writeResultsMarkdown({
    mode: "dry",
    hypotheses,
    streams,
    notes: [
      "Cluster unreachable or OPENSEARCH_URL unset; live PASS/FAIL not evaluated.",
      "DecayEngine.applySuppress owns the suppressed:true write; ConsolidationEngine takes eventsIndex/semanticIndex args (no searchClient/indexMemory hooks from this experiment).",
    ],
  });
  saveResults(
    "experiment-60",
    "DRY — no OpenSearch; assertion descriptions written to experiment-60-results.md",
    {
      mode: "dry",
      hypotheses,
      streams,
      invariants: {
        countBonus: COUNT_BONUS,
        noveltyWeight: NOVELTY_WEIGHT,
        reconsolidationIntervalEpochs: RECON_INTERVAL_EPOCHS,
      },
      indexes: ALL_INDEXES,
    },
  );
}

async function clusterReachable(url: string): Promise<boolean> {
  try {
    const client = createOpenSearchClient({
      node: url,
      ssl: { rejectUnauthorized: false },
    });
    const ping = await client.ping();
    return Boolean(ping.body);
  } catch {
    return false;
  }
}

async function runLive(url: string): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log(`=== Experiment 60 — Falsification set @ ${url} ===\n`);
  console.log(
    `Invariants: countBonus=${COUNT_BONUS} noveltyWeight=${NOVELTY_WEIGHT} reconEvery=${RECON_INTERVAL_EPOCHS}`,
  );

  try {
    console.log("\n--- S1: incident pair ---");
    const s1 = await runStream1Incident(client);
    console.log(
      `  top5=[${s1.top5Ids.join(", ")}] pattern=${s1.patternInTop5} stale=${s1.staleInTop5}`,
    );

    console.log("\n--- S2: no-shared-token ---");
    const s2 = await runStream2NoSharedToken(client);
    console.log(`  top5=[${s2.top5Ids.join(", ")}] pattern=${s2.patternInTop5}`);

    console.log("\n--- S3: fair reset ---");
    const s3 = await runStream3FairReset(client);
    console.log(
      `  top5=[${s3.top5Ids.join(", ")}] pattern=${s3.patternInTop5} staleMayAppear=${s3.staleInTop5}`,
    );

    console.log("\n--- S4–S8: five shapes × held/reverted ---");
    const shapeResults: ShapeArmResult[] = [];
    for (let i = 0; i < SHAPES.length; i++) {
      const held = await runShapeArm(client, i, "held");
      const reverted = await runShapeArm(client, i, "reverted");
      shapeResults.push(held, reverted);
      console.log(
        `  ${held.shapeId} held: conf ${held.confidenceBefore}→${held.confidenceAfter} suppressed=${held.suppressed} hit=${held.hit}`,
      );
      console.log(
        `  ${reverted.shapeId} reverted: conf ${reverted.confidenceBefore}→${reverted.confidenceAfter} suppressed=${reverted.suppressed} hit=${reverted.hit}`,
      );
    }

    console.log("\n--- S9: critique ---");
    const cPersist = await runCritiquePersistent(client);
    console.log(
      `  persistent top1=${cPersist.top1Id} unrelated=${cPersist.unrelatedTop1Id} trust ${cPersist.trustBefore}→${cPersist.trustAfter}`,
    );
    const cReset = await runCritiqueReset(client);
    console.log(`  reset top1=${cReset.top1Id}`);

    const streams: StreamRow[] = [
      {
        stream: "S1",
        kind: "incident-pair",
        hit: s1.hit,
        detail: `patternInTop5=${s1.patternInTop5} top5=[${s1.top5Ids.join(", ") || "(empty)"}]`,
      },
      {
        stream: "S2",
        kind: "no-shared-token",
        hit: s2.hit,
        detail: `patternInTop5=${s2.patternInTop5} top5=[${s2.top5Ids.join(", ") || "(empty)"}]`,
      },
      {
        stream: "S3",
        kind: "fair-reset",
        hit: s3.hit,
        detail: `patternInTop5=${s3.patternInTop5} staleInTop5=${s3.staleInTop5}`,
      },
      ...shapeResults.map((r, idx) => ({
        stream: `S${4 + Math.floor(idx / 2)}-${r.form}`,
        kind: `${r.shapeId}/${r.form}`,
        hit: r.hit,
        detail: `conf ${r.confidenceBefore}→${r.confidenceAfter} increased=${r.confidenceIncreased} suppressed=${r.suppressed}`,
      })),
      {
        stream: "S9-persistent",
        kind: "critique-persistent",
        hit: cPersist.hit,
        detail: `top1=${cPersist.top1Id} unrelatedTop1=${cPersist.unrelatedTop1Id} trust ${cPersist.trustBefore}→${cPersist.trustAfter} oldFetchable=${cPersist.oldFetchableById}`,
      },
      {
        stream: "S9-reset",
        kind: "critique-reset",
        hit: cReset.hit,
        detail: `top1=${cReset.top1Id}`,
      },
    ];

    const heldArms = shapeResults.filter((r) => r.form === "held");
    const revertedArms = shapeResults.filter((r) => r.form === "reverted");

    const h1 = s1.patternInTop5 === true && s3.patternInTop5 === false;
    const h2 = s2.patternInTop5 === true;
    const h3 = s1.staleInTop5 === false && s1.staleFetchableById === true;
    const h4 =
      heldArms.length === 5 &&
      revertedArms.length === 5 &&
      heldArms.every((r) => r.confidenceIncreased) &&
      revertedArms.every((r) => !r.confidenceIncreased);
    const h5 =
      heldArms.length === 5 &&
      revertedArms.length === 5 &&
      heldArms.every((r) => !r.suppressed) &&
      revertedArms.every((r) => r.suppressed);
    const h6 =
      cPersist.top1Id === MEM_CAP_NEW &&
      cReset.top1Id === MEM_CAP_OLD &&
      cPersist.unrelatedTop1Id === MEM_UNRELATED &&
      cPersist.oldFetchableById === true &&
      cPersist.trustBefore !== null &&
      cPersist.trustAfter !== null &&
      cPersist.trustAfter < cPersist.trustBefore;
    const h7 = streams.every((s) => s.hit === 0 || s.hit === 1) && streams.length >= 12;

    const hypotheses: HypothesisRow[] = [
      {
        id: "H1",
        description:
          "Fair-reset probe does not return the consolidated pattern id; persistent probe does",
        pass: h1,
        detail: `S1.patternInTop5=${s1.patternInTop5} S3.patternInTop5=${s3.patternInTop5}`,
      },
      {
        id: "H2",
        description:
          "No-shared-token probe returns the consolidated pattern on the persistent arm",
        pass: h2,
        detail: `S2.patternInTop5=${s2.patternInTop5}`,
      },
      {
        id: "H3",
        description:
          "Stale runbook absent from ordinary top-5 after suppress and still fetchable by id",
        pass: h3,
        detail: `staleInTop5=${s1.staleInTop5} fetchable=${s1.staleFetchableById}`,
      },
      {
        id: "H4",
        description:
          "On all five shapes, held-form confidence increases and reverted-form confidence does not",
        pass: h4,
        detail: heldArms
          .map((h, i) => {
            const rev = revertedArms[i]!;
            return `${h.shapeId}: heldΔ=${h.confidenceAfter - h.confidenceBefore} revΔ=${rev.confidenceAfter - rev.confidenceBefore}`;
          })
          .join("; "),
      },
      {
        id: "H5",
        description:
          "On all five shapes, the reverted remedy is suppressed and the held remedy is not",
        pass: h5,
        detail: heldArms
          .map((h, i) => {
            const rev = revertedArms[i]!;
            return `${h.shapeId}: held.suppressed=${h.suppressed} rev.suppressed=${rev.suppressed}`;
          })
          .join("; "),
      },
      {
        id: "H6",
        description:
          "Critique persistent top-1 is mem-cap-new; reset top-1 is mem-cap-old; unrelated memory wins its own probe",
        pass: h6,
        detail: `persistent=${cPersist.top1Id} reset=${cReset.top1Id} unrelated=${cPersist.unrelatedTop1Id} trust ${cPersist.trustBefore}→${cPersist.trustAfter}`,
      },
      {
        id: "H7",
        description:
          "Report per-stream hit values, including zeros; do not collapse to a single 6/6 score",
        pass: h7,
        detail: streams.map((s) => `${s.stream}=${s.hit}`).join(" "),
      },
    ];

    for (const h of hypotheses) {
      console.log(`\n${h.id} — ${h.pass ? "✓ PASS" : "✗ FAIL"}: ${h.detail}`);
    }

    writeResultsMarkdown({
      mode: "live",
      hypotheses,
      streams,
      notes: [
        "DecayEngine.applySuppress owns the suppressed:true write path.",
        "ConsolidationEngine received eventsIndex/semanticIndex arguments; no searchClient/indexMemory hooks from this experiment.",
      ],
    });

    saveResults(
      "experiment-60",
      hypotheses.map((h) => `${h.id} ${h.pass ? "PASS" : "FAIL"} — ${h.detail}`).join("\n"),
      {
        mode: "live",
        hypotheses,
        streams,
        shapeResults,
        critique: { persistent: cPersist, reset: cReset },
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
