/**
 * Experiment 17 — Operational Signal Retrieval
 *
 * Experiment 15 validated the operational signal schema. This experiment
 * indexes the generated signals into `experience_events` and verifies that
 * BM25 text search over `summary` recovers the correct incident windows.
 *
 * The operational signals are mapped to `experience_events` fields:
 *   summary       ← narrative built from service + window + severity
 *   tags          ← [window, service, "operational"]
 *   importance_score ← payload.severity
 *   event_type    ← "environmental_observation"
 *
 * Three query patterns are tested:
 *   Q1 "postgres outage latency" — should surface outage-window signals
 *   Q2 "service recovery resolved" — should surface recovery-window signals
 *   Q3 "normal background metrics" — should surface normal-window signals
 *
 * Hypotheses:
 *   H1: Q1 top-3 results are all outage-window signals (tags include "outage").
 *   H2: Q2 top-3 results are majority recovery-window signals.
 *   H3: Mean importance_score of Q1 results > mean importance_score of Q3
 *       results — severity ranking is reflected in retrieval score ordering.
 *   H4: After indexing, a tag-filtered search for "outage" returns exactly
 *       the 50 outage-window signals and no others.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp17
 */

import {
  createOpenSearchClient,
  indexDocument,
  search,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { generateAllOperationalData } from "./generators/operational.js";
import { saveResults } from "./results.js";

const INDEX = "experience_events" as const;
const EXP17_TAG = "exp17-operational" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperienceDoc extends Record<string, unknown> {
  event_id: string;
  timestamp: string;
  event_type: string;
  summary: string;
  importance_score: number;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a window label to a human-readable summary string for BM25. */
function buildSummary(
  window: string,
  service: string,
  severity: number,
  hasZendesk: boolean,
  hasSlack: boolean,
): string {
  const parts: string[] = [];
  if (window === "outage") {
    parts.push(`Outage detected on ${service}. Latency p95 severely elevated. Critical incident.`);
  } else if (window === "degraded") {
    parts.push(`Performance degraded on ${service}. Latency rising above threshold.`);
  } else if (window === "recovery") {
    parts.push(`Service ${service} recovering. Incident resolved, metrics returning to normal.`);
  } else {
    parts.push(`Normal background metrics for ${service}. No anomalies detected.`);
  }
  if (hasZendesk) parts.push("Zendesk ticket opened for slow queries and timeouts.");
  if (hasSlack) parts.push("Ops team discussing in Slack ops-alerts channel.");
  parts.push(`Severity score ${severity.toFixed(2)}.`);
  return parts.join(" ");
}

async function deleteExp17Docs(client: ReturnType<typeof createOpenSearchClient>): Promise<void> {
  await client.deleteByQuery({
    index: INDEX,
    body: {
      query: { term: { tags: EXP17_TAG } },
    },
    refresh: true,
  } as Parameters<typeof client.deleteByQuery>[0]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 17: Operational Signal Retrieval ===\n");

  // Clean up any prior run
  await deleteExp17Docs(client);

  // Generate and index operational signals
  const signals = generateAllOperationalData();
  console.log(`Indexing ${signals.length} operational signals into ${INDEX}...`);

  for (const signal of signals) {
    const window = (signal.tags.find((t) => ["normal", "degraded", "outage", "recovery"].includes(t)) ?? "normal") as string;
    const service = signal.tags.find((t) => t.includes("-")) ?? "unknown-service";
    const hasZendesk = signal.payload.zendesk !== undefined;
    const hasSlack = signal.payload.slack !== undefined;

    const doc: ExperienceDoc = {
      event_id: signal.eventId,
      timestamp: signal.timestamp,
      event_type: "environmental_observation",
      summary: buildSummary(window, service, signal.importanceScore, hasZendesk, hasSlack),
      importance_score: signal.importanceScore,
      tags: [...signal.tags, EXP17_TAG],
    };

    await indexDocument(client, INDEX, signal.eventId, doc);
  }

  // Wait for index to refresh
  await client.indices.refresh({ index: INDEX });
  console.log("Index refreshed.\n");

  // Run retrieval queries
  const runQuery = async (queryText: string, topK: number = 5): Promise<ExperienceDoc[]> => {
    const hits = await search<ExperienceDoc>(client, INDEX, {
      size: topK,
      query: {
        bool: {
          must: [
            { match: { summary: { query: queryText, operator: "or" } } },
            { term: { tags: EXP17_TAG } },
          ],
        },
      },
    });
    return hits.map((h) => h._source);
  };

  console.log("Q1: 'postgres outage latency'");
  const q1 = await runQuery("postgres outage latency");
  for (const d of q1) console.log(`  ${d.event_id} tags=[${d.tags.filter(t => t !== EXP17_TAG).join(",")}] importance=${d.importance_score.toFixed(3)}`);

  console.log("\nQ2: 'service recovery resolved'");
  const q2 = await runQuery("service recovery resolved");
  for (const d of q2) console.log(`  ${d.event_id} tags=[${d.tags.filter(t => t !== EXP17_TAG).join(",")}] importance=${d.importance_score.toFixed(3)}`);

  console.log("\nQ3: 'normal background metrics'");
  const q3 = await runQuery("normal background metrics");
  for (const d of q3) console.log(`  ${d.event_id} tags=[${d.tags.filter(t => t !== EXP17_TAG).join(",")}] importance=${d.importance_score.toFixed(3)}`);

  // Tag filter count
  const outageHits = await search<ExperienceDoc>(client, INDEX, {
    size: 200,
    query: {
      bool: {
        must: [
          { term: { tags: "outage" } },
          { term: { tags: EXP17_TAG } },
        ],
      },
    },
  });
  console.log(`\nTag filter 'outage': ${outageHits.length} hits`);

  // Cleanup
  await deleteExp17Docs(client);
  console.log("Cleaned up exp17 documents.");

  // Evaluate hypotheses
  const q1WindowTags = q1.slice(0, 3).map((d) => d.tags.find((t) => ["normal","degraded","outage","recovery"].includes(t)) ?? "unknown");
  const h1Pass = q1WindowTags.every((t) => t === "outage");
  console.log(`\nH1 — Q1 top-3 are outage: [${q1WindowTags.join(",")}]: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  const q2WindowTags = q2.slice(0, 3).map((d) => d.tags.find((t) => ["normal","degraded","outage","recovery"].includes(t)) ?? "unknown");
  const recoveryCount = q2WindowTags.filter((t) => t === "recovery").length;
  const h2Pass = recoveryCount >= 2;
  console.log(`H2 — Q2 top-3 majority recovery: [${q2WindowTags.join(",")}] (${recoveryCount}/3 recovery): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  const q1AvgImportance = q1.reduce((s, d) => s + d.importance_score, 0) / q1.length;
  const q3AvgImportance = q3.reduce((s, d) => s + d.importance_score, 0) / q3.length;
  const h3Pass = q1AvgImportance > q3AvgImportance;
  console.log(`H3 — Q1 avg importance (${q1AvgImportance.toFixed(3)}) > Q3 avg importance (${q3AvgImportance.toFixed(3)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  const h4Pass = outageHits.length === 50;
  console.log(`H4 — tag filter 'outage' returns exactly 50: ${outageHits.length}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  saveResults(
    "exp17",
    [
      `H1 Q1 top-3 all outage: ${h1Pass ? "PASS" : "FAIL"} ([${q1WindowTags.join(",")}])`,
      `H2 Q2 top-3 majority recovery: ${h2Pass ? "PASS" : "FAIL"} (${recoveryCount}/3)`,
      `H3 Q1 avg importance > Q3: ${h3Pass ? "PASS" : "FAIL"} (${q1AvgImportance.toFixed(3)} vs ${q3AvgImportance.toFixed(3)})`,
      `H4 tag filter outage = 50: ${h4Pass ? "PASS" : "FAIL"} (${outageHits.length})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      q1Results: q1.map((d) => ({ id: d.event_id, tags: d.tags, importance: d.importance_score })),
      q2Results: q2.map((d) => ({ id: d.event_id, tags: d.tags, importance: d.importance_score })),
      q3Results: q3.map((d) => ({ id: d.event_id, tags: d.tags, importance: d.importance_score })),
      outageTagCount: outageHits.length,
    },
  );

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
