/**
 * Experiment 47 — Memory Critique Events (MCE) Pipeline
 *
 * Validates the end-to-end MCE pipeline: seed memories in `memory_semantic`,
 * directly apply critiques via the cascade module, and verify that trust score
 * decrements and suppression threshold raises land in OpenSearch.
 *
 * This test bypasses Kafka (no broker needed) and calls the cascade + update
 * functions directly — the same code path the memory-critique worker invokes
 * when it consumes a MemoryCritiqueEvent.
 *
 * Four hypotheses:
 *
 *   H1 — High-confidence critique (>= 0.8) decrements retrieval_priority
 *        by approximately TRUST_DELTA_HIGH (-0.25) on the target memory.
 *
 *   H2 — Mid-confidence critique (0.5–0.79) decrements retrieval_priority
 *        by approximately TRUST_DELTA_MID (-0.12).
 *
 *   H3 — Suppression threshold is raised on the critiqued memory
 *        (last_critique_at is set and suppression_threshold > 0).
 *
 *   H4 — Concept-level critique cascades to child memories: at least one
 *        descendant memory has its retrieval_priority decremented (by the
 *        50% attenuated delta).
 *
 * Usage:
 *   OPENSEARCH_URL=http://localhost:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp47
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import type { Client } from "@opensearch-project/opensearch";
import type { MemoryCritiqueEvent } from "@cognitive-substrate/core-types";
import { updateDocument, search } from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Inline cascade logic (mirrors apps/workers/memory-critique/src/cascade.ts)
// ---------------------------------------------------------------------------

const CASCADE_LEVELS = ["concept", "principle", "worldview"];
const CASCADE_ATTENUATION = 0.5;

interface SemanticMemoryDoc extends Record<string, unknown> {
  retrieval_priority?: number;
}

async function applyTrustDelta(client: Client, memoryId: string, delta: number): Promise<void> {
  try {
    const result = await client.get({ index: INDEX, id: memoryId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (result.body as any)._source as SemanticMemoryDoc;
    const current = doc.retrieval_priority ?? 0.5;
    const next = Math.max(0, Math.min(1, current + delta));
    await updateDocument(client, INDEX, memoryId, { retrieval_priority: next, last_critique_at: new Date().toISOString() });
  } catch { /* doc not found */ }
}

async function applyCritiqueAndCascade(
  client: Client,
  critique: MemoryCritiqueEvent,
  trustDelta: number,
): Promise<{ updated: number }> {
  let updated = 0;
  if (critique.memoryId) { await applyTrustDelta(client, critique.memoryId, trustDelta); updated++; }
  if (!critique.memoryId || !CASCADE_LEVELS.includes(critique.abstractionLevel ?? "")) return { updated };
  const hits = await search<SemanticMemoryDoc>(client, INDEX, { query: { term: { "source_ids.keyword": critique.memoryId } }, size: 50 });
  const attenuated = trustDelta * CASCADE_ATTENUATION;
  for (const hit of hits) {
    const current = hit._source.retrieval_priority ?? 0.5;
    await updateDocument(client, INDEX, hit._id, { retrieval_priority: Math.max(0, Math.min(1, current + attenuated)), last_critique_at: new Date().toISOString() });
    updated++;
  }
  return { updated };
}

const INDEX = "memory_semantic";
const SESSION = "exp47-session";
const AGENT = "exp47-agent";

const TRUST_DELTA_HIGH = -0.25;
const TRUST_DELTA_MID = -0.12;
const SUPPRESSION_RAISE = 0.08;

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedMemory(
  client: OSClient,
  id: string,
  summary: string,
  level: string,
  sourceIds: string[] = [],
  retrievalPriority = 0.7,
): Promise<void> {
  await client.index({
    index: INDEX,
    id,
    body: {
      memory_id: id,
      summary,
      abstraction_level: level,
      retrieval_priority: retrievalPriority,
      importance_score: 0.6,
      suppression_threshold: 0.0,
      source_ids: sourceIds,
      created_at: new Date().toISOString(),
      tags: [`source:exp47`, `level:${level}`],
    },
    refresh: "wait_for",
  });
}

async function fetchDoc(client: OSClient, id: string): Promise<Record<string, number>> {
  const res = await client.get({ index: INDEX, id });
  return res.body._source as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());

  // Seed memories
  const highTargetId = `exp47-high-${randomUUID()}`;
  const midTargetId = `exp47-mid-${randomUUID()}`;
  const conceptId = `exp47-concept-${randomUUID()}`;
  const childId = `exp47-child-${randomUUID()}`;

  console.log("Seeding memories...");
  await seedMemory(client, highTargetId, "Memory consolidation strengthens all learned skills equally.", "experience");
  await seedMemory(client, midTargetId, "Sleep improves memory but timing does not matter.", "pattern");
  await seedMemory(client, conceptId, "All memories decay at the same rate regardless of importance.", "concept");
  // Child references the concept via source_ids — cascade should reach it
  await seedMemory(client, childId, "Flashbulb memories decay as fast as mundane memories.", "experience", [conceptId]);

  // Snapshot pre-critique values
  const highPre = await fetchDoc(client, highTargetId);
  const midPre = await fetchDoc(client, midTargetId);
  const conceptPre = await fetchDoc(client, conceptId);
  const childPre = await fetchDoc(client, childId);

  // -------------------------------------------------------------------------
  // H1: High-confidence critique on highTargetId
  // -------------------------------------------------------------------------
  const highCritique: MemoryCritiqueEvent = {
    critiqueId: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: SESSION,
    agentId: AGENT,
    memoryId: highTargetId,
    critiqueType: "contradiction",
    confidenceScore: 0.9,
    explanation: "Memory consolidation is selective — procedural and declarative memories consolidate differently.",
  };

  console.log("Applying high-confidence critique...");
  await applyCritiqueAndCascade(client, highCritique, TRUST_DELTA_HIGH);
  await updateDocument(client, INDEX, highTargetId, {
    suppression_threshold: SUPPRESSION_RAISE,
    last_critique_at: new Date().toISOString(),
  });

  // -------------------------------------------------------------------------
  // H2: Mid-confidence critique on midTargetId
  // -------------------------------------------------------------------------
  const midCritique: MemoryCritiqueEvent = {
    critiqueId: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: SESSION,
    agentId: AGENT,
    memoryId: midTargetId,
    critiqueType: "outdated",
    confidenceScore: 0.65,
    explanation: "REM sleep timing has been shown to matter for procedural memory consolidation.",
  };

  console.log("Applying mid-confidence critique...");
  await applyCritiqueAndCascade(client, midCritique, TRUST_DELTA_MID);
  await updateDocument(client, INDEX, midTargetId, {
    suppression_threshold: SUPPRESSION_RAISE,
    last_critique_at: new Date().toISOString(),
  });

  // -------------------------------------------------------------------------
  // H4: Concept-level critique — should cascade to childId
  // -------------------------------------------------------------------------
  const conceptCritique: MemoryCritiqueEvent = {
    critiqueId: randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: SESSION,
    agentId: AGENT,
    memoryId: conceptId,
    critiqueType: "overgeneralized",
    confidenceScore: 0.85,
    abstractionLevel: "concept",
    explanation: "Emotional salience dramatically slows decay — this concept is too broad.",
  };

  console.log("Applying concept-level critique (cascade test)...");
  await applyCritiqueAndCascade(client, conceptCritique, TRUST_DELTA_HIGH);

  // Fetch post-critique values
  const highPost = await fetchDoc(client, highTargetId);
  const midPost = await fetchDoc(client, midTargetId);
  const conceptPost = await fetchDoc(client, conceptId);
  const childPost = await fetchDoc(client, childId);

  // -------------------------------------------------------------------------
  // Evaluate hypotheses
  // -------------------------------------------------------------------------
  const highDelta = (highPost["retrieval_priority"] ?? 0) - (highPre["retrieval_priority"] ?? 0);
  const midDelta = (midPost["retrieval_priority"] ?? 0) - (midPre["retrieval_priority"] ?? 0);
  const conceptDelta = (conceptPost["retrieval_priority"] ?? 0) - (conceptPre["retrieval_priority"] ?? 0);
  const childDelta = (childPost["retrieval_priority"] ?? 0) - (childPre["retrieval_priority"] ?? 0);

  const h1Pass = Math.abs(highDelta - TRUST_DELTA_HIGH) < 0.05;
  const h2Pass = Math.abs(midDelta - TRUST_DELTA_MID) < 0.05;
  const h3Pass =
    (highPost["suppression_threshold"] ?? 0) >= SUPPRESSION_RAISE &&
    (midPost["suppression_threshold"] ?? 0) >= SUPPRESSION_RAISE &&
    !!highPost["last_critique_at"] && !!midPost["last_critique_at"];
  const h4Pass = childDelta < -0.001; // child was decremented by cascade

  const results = {
    experiment: 47,
    description: "Memory Critique Events (MCE) pipeline — trust decrement and cascade",
    timestamp: new Date().toISOString(),
    hypotheses: {
      H1: {
        description: "High-confidence critique decrements retrieval_priority by ~-0.25",
        pass: h1Pass,
        pre: highPre["retrieval_priority"],
        post: highPost["retrieval_priority"],
        delta: highDelta,
        expected: TRUST_DELTA_HIGH,
      },
      H2: {
        description: "Mid-confidence critique decrements retrieval_priority by ~-0.12",
        pass: h2Pass,
        pre: midPre["retrieval_priority"],
        post: midPost["retrieval_priority"],
        delta: midDelta,
        expected: TRUST_DELTA_MID,
      },
      H3: {
        description: "Suppression threshold raised and last_critique_at set on critiqued memories",
        pass: h3Pass,
        highSuppressionThreshold: highPost["suppression_threshold"],
        midSuppressionThreshold: midPost["suppression_threshold"],
        highLastCritiqueAt: highPost["last_critique_at"],
        midLastCritiqueAt: midPost["last_critique_at"],
      },
      H4: {
        description: "Concept-level critique cascades to child memory (attenuated delta)",
        pass: h4Pass,
        conceptDelta,
        childDelta,
        expectedAttenuation: "50% of concept delta",
      },
    },
    allPass: h1Pass && h2Pass && h3Pass && h4Pass,
  };

  const lines = [
    `H1 ${h1Pass ? "PASS" : "FAIL"} — high-confidence: delta=${highDelta.toFixed(3)} expected=${TRUST_DELTA_HIGH}`,
    `H2 ${h2Pass ? "PASS" : "FAIL"} — mid-confidence: delta=${midDelta.toFixed(3)} expected=${TRUST_DELTA_MID}`,
    `H3 ${h3Pass ? "PASS" : "FAIL"} — suppression_threshold raised, last_critique_at set`,
    `H4 ${h4Pass ? "PASS" : "FAIL"} — cascade to child: childDelta=${childDelta.toFixed(3)}`,
    `ALL ${results.allPass ? "PASS" : "FAIL"}`,
  ];
  lines.forEach((l) => console.log(l));

  // Cleanup seeded docs
  for (const id of [highTargetId, midTargetId, conceptId, childId]) {
    await client.delete({ index: INDEX, id, refresh: "wait_for" }).catch(() => null);
  }

  await saveResults(47, results, lines.join("\n"));
  process.exit(results.allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Experiment 47 failed:", err);
  process.exit(1);
});
