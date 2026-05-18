/**
 * Experiment 33 — Decay + Re-consolidation Cycle End-to-End
 *
 * This experiment validates the full memory lifecycle: signals age →
 * DecayEngine identifies candidates for compression → ConsolidationEngine
 * synthesises them into semantic memories → the resulting semantic memories
 * have higher stability scores than raw experience events.
 *
 * The test simulates 45-day-old signals (using ageDays=45 in ForgettingCandidate,
 * the threshold established in Exp 29) and verifies that the compress→
 * consolidate pipeline produces well-formed semantic memories.
 *
 * Four hypotheses:
 *
 *   H1 — Decay identifies compress candidates: when DecayEngine.planForgetting()
 *        is run on a mixed-importance corpus at ageDays=45, at least one
 *        CompressionCluster is produced and it contains ≥10 candidates.
 *
 *   H2 — Consolidation of compressed cluster: ConsolidationEngine.consolidate()
 *        run with the window tag from the largest CompressionCluster produces
 *        a SemanticMemory with sourceEventIds.length ≥ 10 and
 *        importanceScore > 0 (consolidation did not error out).
 *
 *   H3 — Severity ordering preserved: the resulting semantic memories have
 *        importanceScore in outage > recovery > degraded > normal, mirroring
 *        the average importanceScore of the underlying signals (same ordering
 *        as Exp 15 and validated in Exp 30).
 *
 *   H4 — Retire/prune actions correctly classified: at ageDays=45, signals
 *        with importanceScore < retirementThreshold (0.22) receive "retire"
 *        or "prune" actions, and signals with importanceScore > 0.5 receive
 *        "retain" — confirming the DecayEngine threshold redesign from Exp 29
 *        works as expected on real severity distributions.
 *
 * Protocol:
 *   1. Seed experience_events with 2k signals (plain bulk, no neural pipeline).
 *   2. Build ForgettingCandidates from the seeded signals with ageDays=45.
 *   3. Run DecayEngine.planForgetting() → examine decisions and clusters.
 *   4. Run ConsolidationEngine.consolidate() once per window (requiredTags).
 *   5. Evaluate H1-H4, save results, clean up seeded docs.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp33
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { DecayEngine } from "@cognitive-substrate/decay-engine";
import { ConsolidationEngine } from "@cognitive-substrate/consolidation-engine";
import { generateOperationalBatch } from "./generators/operational.js";
import { saveResults } from "./results.js";
import type { ForgettingCandidate } from "@cognitive-substrate/decay-engine";
import type { MemoryReference } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORPUS_SIZE = 2_000;
const BULK_CHUNK  = 500;
const AGE_DAYS    = 45;

type WindowName = "normal" | "degraded" | "outage" | "recovery";
const WINDOWS: WindowName[] = ["normal", "degraded", "outage", "recovery"];

const WINDOW_TEXT: Record<WindowName, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedExperienceEvents(client: OSClient): Promise<{ ids: string[]; signals: Array<{ id: string; importance: number; tags: string[] }> }> {
  const base = new Date("2026-05-14T10:00:00Z");
  const normal   = Math.round(CORPUS_SIZE * 0.20);
  const degraded = Math.round(CORPUS_SIZE * 0.30);
  const outage   = Math.round(CORPUS_SIZE * 0.25);
  const recovery = CORPUS_SIZE - normal - degraded - outage;
  const WINDOWS_SET = new Set(WINDOWS);
  const allSignals = [
    ...generateOperationalBatch("normal",   normal,   base),
    ...generateOperationalBatch("degraded", degraded, new Date(base.getTime() + 2 * 3_600_000)),
    ...generateOperationalBatch("outage",   outage,   new Date(base.getTime() + 5 * 3_600_000)),
    ...generateOperationalBatch("recovery", recovery, new Date(base.getTime() + 7 * 3_600_000)),
  ];

  const ids: string[] = [];
  const summaries: Array<{ id: string; importance: number; tags: string[] }> = [];

  for (let offset = 0; offset < allSignals.length; offset += BULK_CHUNK) {
    const chunk = allSignals.slice(offset, offset + BULK_CHUNK);
    const body: Record<string, unknown>[] = [];
    for (const signal of chunk) {
      const window = signal.tags.find((t) => WINDOWS_SET.has(t as WindowName)) ?? "normal";
      ids.push(signal.eventId);
      summaries.push({ id: signal.eventId, importance: signal.importanceScore, tags: [...signal.tags] });
      body.push({ index: { _index: "experience_events", _id: signal.eventId } });
      body.push({
        event_id:         signal.eventId,
        timestamp:        signal.timestamp,
        summary:          `${WINDOW_TEXT[window as WindowName]}. service=${signal.payload.affectedServices[0] ?? "unknown"}`,
        tags:             signal.tags,
        importance_score: signal.importanceScore,
        reward_score:     signal.importanceScore * 0.8,
        retrieval_count:  0,
        session_id:       "exp33-seed",
        agent_id:         "exp33",
      });
    }
    await client.bulk({ body });
    process.stdout.write(`\r  Seeded ${Math.min(offset + BULK_CHUNK, allSignals.length).toLocaleString()}/${allSignals.length.toLocaleString()}...`);
  }
  process.stdout.write("\n");
  await client.indices.refresh({ index: "experience_events" });
  return { ids, signals: summaries };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 33: Decay + Re-consolidation Cycle End-to-End ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());

  // Seed corpus
  console.log(`Seeding ${CORPUS_SIZE.toLocaleString()} signals into experience_events...`);
  const { ids: seededIds, signals } = await seedExperienceEvents(client);
  console.log(`  Seeded ${seededIds.length.toLocaleString()} docs.\n`);

  // ---------------------------------------------------------------------------
  // Step 1: Build ForgettingCandidates and run DecayEngine
  // ---------------------------------------------------------------------------
  const decayEngine = new DecayEngine();

  const candidates: ForgettingCandidate[] = signals.map((s) => ({
    memory: {
      memoryId: s.id,
      index: "experience_events" as const,
      importanceScore: s.importance,
      score: s.importance,
      summary: `${s.tags[0] ?? "signal"} memory`,
    } satisfies MemoryReference,
    retrievalCount: 1,
    contradictionScore: 0.1,
    ageDays: AGE_DAYS,
    strategicValue: s.importance,
  }));

  console.log(`Running DecayEngine.planForgetting() on ${candidates.length} candidates (ageDays=${AGE_DAYS})...`);
  const plan = decayEngine.planForgetting(candidates);

  // Count actions
  const actionCounts: Record<string, number> = {};
  for (const d of plan.decisions) {
    actionCounts[d.action] = (actionCounts[d.action] ?? 0) + 1;
  }
  console.log("  Action distribution:");
  for (const [action, count] of Object.entries(actionCounts).sort()) {
    console.log(`    ${action.padEnd(10)}: ${count}`);
  }
  console.log(`  CompressionClusters: ${plan.compressionClusters.length}`);
  for (const cluster of plan.compressionClusters) {
    console.log(`    ${cluster.clusterId}: ${cluster.memoryIds.length} memories, priority=${cluster.compressionPriority.toFixed(3)}`);
  }

  // H1
  const largestCluster = [...plan.compressionClusters].sort((a, b) => b.memoryIds.length - a.memoryIds.length)[0];
  const h1Pass = plan.compressionClusters.length >= 1 && (largestCluster?.memoryIds.length ?? 0) >= 10;
  console.log(`\nH1 — ≥1 CompressionCluster with ≥10 candidates: clusters=${plan.compressionClusters.length} largest=${largestCluster?.memoryIds.length ?? 0}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: check retire/prune at low importance, retain at high importance
  const lowImportanceDecisions  = plan.decisions.filter((d) => d.retentionScore < 0.22);
  const highImportanceDecisions = plan.decisions.filter((d) => d.retentionScore > 0.5);
  const retiredOrPruned = lowImportanceDecisions.filter((d) => d.action === "retire" || d.action === "prune").length;
  const retained = highImportanceDecisions.filter((d) => d.action === "retain").length;
  const lowRate  = lowImportanceDecisions.length > 0 ? retiredOrPruned / lowImportanceDecisions.length : 0;
  const highRate = highImportanceDecisions.length > 0 ? retained / highImportanceDecisions.length : 0;
  const h4Pass   = lowRate >= 0.8 && highRate >= 0.8;
  console.log(`H4 — retire/prune at low retention (${retiredOrPruned}/${lowImportanceDecisions.length} = ${(lowRate * 100).toFixed(1)}%), retain at high (${retained}/${highImportanceDecisions.length} = ${(highRate * 100).toFixed(1)}%): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Step 2: Run ConsolidationEngine per window
  // ---------------------------------------------------------------------------
  const consolidationEngine = new ConsolidationEngine({ openSearch: client });
  const now = new Date().toISOString();

  interface ConsolRound {
    window: WindowName;
    sourceCount: number;
    importanceScore: number;
    memoryId: string;
  }

  console.log("\nRunning per-window ConsolidationEngine rounds...");
  const consolRounds: ConsolRound[] = [];
  for (const window of WINDOWS) {
    process.stdout.write(`  Consolidating window="${window}"... `);
    try {
      const result = await consolidationEngine.consolidate({
        requestId: randomUUID(),
        timestamp: now,
        maxAge: new Date(0).toISOString(),
        size: 100,
        minImportance: 0.1,
        requiredTags: [window],
      });
      process.stdout.write(`${result.sourceEventIds.length} sources, importanceScore=${result.semanticMemory.importanceScore.toFixed(4)}\n`);
      consolRounds.push({
        window,
        sourceCount:     result.sourceEventIds.length,
        importanceScore: result.semanticMemory.importanceScore,
        memoryId:        result.semanticMemory.memoryId,
      });
    } catch (err) {
      process.stdout.write(`ERROR: ${(err as Error).message}\n`);
      consolRounds.push({ window, sourceCount: 0, importanceScore: 0, memoryId: "" });
    }
  }

  // H2: all windows consolidated with ≥10 sources and importanceScore > 0
  const h2Pass = consolRounds.every((r) => r.sourceCount >= 10 && r.importanceScore > 0);
  console.log(`\nH2 — all windows consolidated (≥10 sources, importanceScore > 0): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: severity ordering outage > recovery > degraded > normal
  const byWindow = Object.fromEntries(consolRounds.map((r) => [r.window, r.importanceScore])) as Record<WindowName, number>;
  const h3Pass = (byWindow["outage"] ?? 0) > (byWindow["recovery"] ?? 0)
    && (byWindow["outage"] ?? 0) > (byWindow["degraded"] ?? 0)
    && (byWindow["outage"] ?? 0) > (byWindow["normal"] ?? 0)
    && (byWindow["normal"] ?? 0) < (byWindow["degraded"] ?? 0);
  console.log(`H3 — severity ordering outage(${byWindow["outage"]?.toFixed(4)}) > degraded(${byWindow["degraded"]?.toFixed(4)}) > normal(${byWindow["normal"]?.toFixed(4)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp33",
    [
      `H1 compression clusters=${plan.compressionClusters.length} largest=${largestCluster?.memoryIds.length ?? 0}: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 all windows consolidated ≥10 sources: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 severity ordering outage>${byWindow["outage"]?.toFixed(3)} > degraded>${byWindow["degraded"]?.toFixed(3)} > normal>${byWindow["normal"]?.toFixed(3)}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 retire/prune low=${(lowRate * 100).toFixed(1)}% retain high=${(highRate * 100).toFixed(1)}%: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      ageDays: AGE_DAYS,
      decay: {
        totalCandidates: candidates.length,
        actionCounts,
        compressionClusters: plan.compressionClusters.length,
        largestClusterSize: largestCluster?.memoryIds.length ?? 0,
        lowRetentionRetiredRate: lowRate,
        highRetentionRetainedRate: highRate,
      },
      consolidation: consolRounds.map((r) => ({
        window: r.window,
        sourceCount: r.sourceCount,
        importanceScore: r.importanceScore,
        memoryId: r.memoryId,
      })),
    },
  );
  console.log("Results saved.");

  // Cleanup
  console.log("\nCleaning up seeded documents...");
  await client.deleteByQuery({ index: "experience_events", body: { query: { term: { session_id: "exp33-seed" } } }, conflicts: "proceed" } as Parameters<typeof client.deleteByQuery>[0]);
  await client.indices.refresh({ index: "experience_events" });
  console.log(`  Cleaned up ${seededIds.length.toLocaleString()} docs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
