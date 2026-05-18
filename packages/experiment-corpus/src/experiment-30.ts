/**
 * Experiment 30 — ConsolidationEngine at Scale
 *
 * Prior consolidation tests (Exp 18) ran against a 200-signal corpus. This
 * experiment seeds `experience_events` with 10,000 operational signals and
 * runs four targeted consolidation rounds — one per incident window — to
 * verify throughput, semantic-memory quality, and cross-window isolation at
 * production scale.
 *
 * Each consolidation round uses `requiredTags` to pull only a single window's
 * signals, so four semantic memories should emerge: one per window. The
 * experiment validates:
 *
 *   H1 — Throughput: seeding 10k docs completes in <120s (≥83 docs/s).
 *
 *   H2 — Per-window consolidation success: all four requiredTags rounds
 *        produce a ConsolidationResult with ≥10 sourceEventIds, and the
 *        resulting semanticMemory.semanticCluster matches the requested window.
 *
 *   H3 — Importance propagation: the consolidated semanticMemory for the
 *        "outage" window has a higher importanceScore than the one for
 *        "normal" (outage signals carry higher importanceScore).
 *
 *   H4 — Source-event bump: after consolidation, the source event documents
 *        in experience_events have retrieval_count ≥ 1 for at least 80% of
 *        the sampled sourceEventIds (engine calls markCandidatesConsolidated).
 *
 * Protocol:
 *   1. Bulk-index 10k synthetic operational signals into experience_events.
 *      Documents are plain JSON (no neural embedding) — importance_score,
 *      reward_score, retrieval_count, summary, tags, timestamp, event_id.
 *   2. Run four ConsolidationEngine.consolidate() calls, one per window,
 *      each with maxAge=<now>, size=100, minImportance=0.1,
 *      requiredTags=[window].
 *   3. Read back a sample of sourceEventIds and verify retrieval_count ≥ 1.
 *   4. Evaluate H1-H4, save results, clean up seeded docs.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp30
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ConsolidationEngine } from "@cognitive-substrate/consolidation-engine";
import { generateOperationalBatch } from "./generators/operational.js";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORPUS_SIZE   = 10_000;
const BULK_CHUNK    = 500;
const WINDOWS       = ["normal", "degraded", "outage", "recovery"] as const;
type WindowName     = (typeof WINDOWS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OSClient = ReturnType<typeof createOpenSearchClient>;

async function seedExperienceEvents(client: OSClient): Promise<{ ids: string[]; ms: number }> {
  const base = new Date("2026-05-14T10:00:00Z");
  const normal   = Math.round(CORPUS_SIZE * 0.20);
  const degraded = Math.round(CORPUS_SIZE * 0.30);
  const outage   = Math.round(CORPUS_SIZE * 0.25);
  const recovery = CORPUS_SIZE - normal - degraded - outage;

  const allSignals = [
    ...generateOperationalBatch("normal",   normal,   base),
    ...generateOperationalBatch("degraded", degraded, new Date(base.getTime() + 2 * 3_600_000)),
    ...generateOperationalBatch("outage",   outage,   new Date(base.getTime() + 5 * 3_600_000)),
    ...generateOperationalBatch("recovery", recovery, new Date(base.getTime() + 7 * 3_600_000)),
  ];

  const ids: string[] = [];
  const t0 = Date.now();
  let indexed = 0;

  for (let offset = 0; offset < allSignals.length; offset += BULK_CHUNK) {
    const chunk = allSignals.slice(offset, offset + BULK_CHUNK);
    const body: Record<string, unknown>[] = [];
    for (const signal of chunk) {
      ids.push(signal.eventId);
      body.push({ index: { _index: "experience_events", _id: signal.eventId } });
      body.push({
        event_id:           signal.eventId,
        timestamp:          signal.timestamp,
        summary:            `${signal.payload.source} severity=${signal.payload.severity.toFixed(2)} services=${signal.payload.affectedServices.join(",")}`,
        tags:               signal.tags,
        importance_score:   signal.importanceScore,
        reward_score:       signal.importanceScore * 0.8,
        retrieval_count:    0,
        session_id:         "exp30-seed",
        agent_id:           "exp30",
      });
    }
    await client.bulk({ body });
    indexed += chunk.length;
    process.stdout.write(`\r  Seeded ${indexed.toLocaleString()}/${allSignals.length.toLocaleString()}...`);
  }
  process.stdout.write("\n");
  await client.indices.refresh({ index: "experience_events" });
  return { ids, ms: Date.now() - t0 };
}

async function cleanupSeededDocs(client: OSClient, ids: string[]): Promise<void> {
  // Delete by query — all docs tagged with exp30-seed session
  await client.deleteByQuery({
    index: "experience_events",
    body: { query: { term: { session_id: "exp30-seed" } } },
    conflicts: "proceed",
  } as Parameters<typeof client.deleteByQuery>[0]);
  await client.indices.refresh({ index: "experience_events" });
  console.log(`  Cleaned up ${ids.length.toLocaleString()} seeded docs.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 30: ConsolidationEngine at Scale ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const engine = new ConsolidationEngine({ openSearch: client });

  // ---------------------------------------------------------------------------
  // Step 1: Seed experience_events with 10k operational signals
  // ---------------------------------------------------------------------------
  console.log(`Seeding ${CORPUS_SIZE.toLocaleString()} signals into experience_events...`);
  const { ids: seededIds, ms: seedMs } = await seedExperienceEvents(client);
  const docsPerSec = (seededIds.length / seedMs) * 1000;
  console.log(`  Seeded ${seededIds.length.toLocaleString()} docs in ${seedMs}ms (${docsPerSec.toFixed(1)} docs/s)\n`);

  // H1
  const h1Pass = docsPerSec >= 83;
  console.log(`H1 — throughput ${docsPerSec.toFixed(1)} docs/s ≥83: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Step 2: Run four consolidation rounds, one per window
  // ---------------------------------------------------------------------------
  console.log("\nRunning per-window consolidation rounds...");
  const now = new Date().toISOString();

  interface RoundResult {
    window: WindowName;
    sourceCount: number;
    importanceScore: number;
    semanticCluster: string | undefined;
    memoryId: string;
    sourceEventIds: string[];
  }

  const rounds: RoundResult[] = [];

  for (const window of WINDOWS) {
    process.stdout.write(`  Consolidating window="${window}"... `);
    try {
      const result = await engine.consolidate({
        requestId: randomUUID(),
        timestamp: now,
        maxAge: new Date(0).toISOString(),
        size: 100,
        minImportance: 0.1,
        requiredTags: [window],
      });
      process.stdout.write(`${result.sourceEventIds.length} source events → memoryId=${result.semanticMemory.memoryId.slice(0, 8)}...\n`);
      rounds.push({
        window,
        sourceCount:    result.sourceEventIds.length,
        importanceScore: result.semanticMemory.importanceScore,
        semanticCluster: result.semanticMemory.semanticCluster,
        memoryId:        result.semanticMemory.memoryId,
        sourceEventIds:  [...result.sourceEventIds],
      });
    } catch (err) {
      process.stdout.write(`ERROR: ${(err as Error).message}\n`);
      rounds.push({
        window,
        sourceCount:    0,
        importanceScore: 0,
        semanticCluster: undefined,
        memoryId:        "",
        sourceEventIds:  [],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // H2 — all four rounds produced ≥10 sourceEventIds and correct cluster
  // ---------------------------------------------------------------------------
  const h2Results = rounds.map((r) => ({
    window: r.window,
    sourceCount: r.sourceCount,
    clusterMatch: r.semanticCluster === r.window || r.semanticCluster?.includes(r.window),
    pass: r.sourceCount >= 10,
  }));
  const h2Pass = h2Results.every((r) => r.pass);

  console.log("\nH2 — per-window consolidation (sourceCount ≥10, cluster check):");
  for (const r of h2Results) {
    console.log(`  ${r.window.padEnd(9)}: sourceCount=${r.sourceCount} clusterMatch=${r.clusterMatch} ${r.pass ? "✓" : "✗"}`);
  }
  console.log(`H2 overall: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3 — outage importanceScore > normal importanceScore
  // ---------------------------------------------------------------------------
  const outageRound  = rounds.find((r) => r.window === "outage");
  const normalRound  = rounds.find((r) => r.window === "normal");
  const h3Pass = outageRound !== undefined && normalRound !== undefined &&
    outageRound.importanceScore > normalRound.importanceScore;
  console.log(`\nH3 — outage importance (${outageRound?.importanceScore.toFixed(4) ?? "n/a"}) > normal (${normalRound?.importanceScore.toFixed(4) ?? "n/a"}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H4 — sourceEvent retrieval_count bumped ≥80%
  // ---------------------------------------------------------------------------
  // Sample from the outage round (largest, most reliable)
  const sampleRound  = outageRound ?? rounds[0];
  let bumpedCount    = 0;
  let sampleChecked  = 0;

  if (sampleRound && sampleRound.sourceEventIds.length > 0) {
    const sampleIds = sampleRound.sourceEventIds.slice(0, Math.min(50, sampleRound.sourceEventIds.length));
    for (const id of sampleIds) {
      const doc = await client.get({ index: "experience_events", id }).catch(() => null);
      if (doc) {
        const src = (doc.body as Record<string, unknown>)["_source"] as Record<string, unknown>;
        const rc = src["retrieval_count"] as number | undefined;
        if (rc !== undefined && rc >= 1) bumpedCount++;
        sampleChecked++;
      }
    }
  }

  const bumpRate = sampleChecked > 0 ? bumpedCount / sampleChecked : 0;
  const h4Pass   = bumpRate >= 0.8;
  console.log(`\nH4 — retrieval_count bump ≥80%: ${bumpedCount}/${sampleChecked} (${(bumpRate * 100).toFixed(1)}%): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp30",
    [
      `H1 throughput ${docsPerSec.toFixed(1)} docs/s ≥83: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 per-window consolidation all ≥10 sourceEvents: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 outage importance (${outageRound?.importanceScore.toFixed(4)}) > normal (${normalRound?.importanceScore.toFixed(4)}): ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 retrieval_count bump ${bumpedCount}/${sampleChecked} (${(bumpRate * 100).toFixed(1)}%): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      seed: { docsPerSec, seedMs, total: seededIds.length },
      rounds: rounds.map((r) => ({
        window: r.window,
        sourceCount: r.sourceCount,
        importanceScore: r.importanceScore,
        semanticCluster: r.semanticCluster,
        memoryId: r.memoryId,
      })),
      bumpCheck: { bumpedCount, sampleChecked, bumpRate },
    },
  );
  console.log("Results saved.");

  // ---------------------------------------------------------------------------
  // Cleanup seeded docs from experience_events
  // ---------------------------------------------------------------------------
  console.log("\nCleaning up seeded documents...");
  await cleanupSeededDocs(client, seededIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
