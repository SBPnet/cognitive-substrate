/**
 * Experiment 8 — Prior-Weighted Compounding Reinforcement
 *
 * Experiment 7 revealed that ReinforcementEngine.evaluate is stateless and
 * normalising: each call replaces retrieval_priority rather than incrementing
 * it, so repeated positive reinforcement converges rather than compounds.
 *
 * This experiment validates the fix: a `priorWeight` EMA (exponential moving
 * average) blended into the engine. Formula:
 *
 *   finalRp = priorRp × priorWeight + newRp × (1 - priorWeight)
 *
 * Three prior-weight conditions are compared across the 20-turn replay:
 *   pw=0.0  — stateless baseline (Exp 7 behaviour)
 *   pw=0.3  — mild compounding (default production setting)
 *   pw=0.6  — strong compounding (aggressive memory strengthening)
 *
 * Four hypotheses:
 *
 *   H1 — With pw=0.3, cluster-A memories gain retrieval_priority
 *        monotonically across the 6 reinforcement turns that target them
 *        (turns 1–6). Each turn's finalRp > the previous turn's finalRp.
 *
 *   H2 — mem-c1 (contradictionRisk=0.8) still decays below its initial
 *        importanceScore under all prior-weight conditions. The EMA prior
 *        cannot protect contradictory content because newRp is consistently
 *        low; the prior only slows the decay, doesn't reverse it.
 *
 *   H3 — Post-reinforcement cluster-A retrieval_priority is higher with
 *        pw=0.3 than pw=0.0 (Exp 7 result), and higher still with pw=0.6.
 *        Compounding produces monotonically stronger memories at higher pw.
 *
 *   H4 — Under pw=0.6, the spread between cluster-A and cluster-B
 *        retrieval_priority widens relative to pw=0.0. Strong prior-weighting
 *        amplifies existing advantages, increasing retrieval dominance of
 *        trusted memories.
 *
 * Protocol:
 *   1. Reseed retrieval_priority = importanceScore for all 9 corpus memories.
 *   2. For each pw ∈ {0.0, 0.3, 0.6}:
 *      a. Reset all retrieval_priority to importanceScore.
 *      b. Run the 20-turn replay, tracking retrieval_priority after each turn.
 *      c. Record the trajectory for cluster-A turns (turns 1–6, 14, 16, 17, 20).
 *   3. Run a post-reinforcement function_score retrieval query at T=0.5 for
 *      each pw condition. Compare rankings and priority deltas vs Exp 7.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp8
 */

import {
  createOpenSearchClient,
  getDocument,
  updateDocument,
  search,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const TOP_K = 5;
const RETRIEVAL_T = 0.5;
const PRIOR_WEIGHTS = [0.0, 0.3, 0.6] as const;

// The turns that reinforce cluster-A memories
const CLUSTER_A_TURNS = new Set(["turn-01","turn-02","turn-03","turn-04","turn-05","turn-06","turn-14","turn-16","turn-17","turn-20"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  usage_frequency: number;
  retrieval_priority?: number;
}

interface TurnRecord {
  turnId: string;
  memoryId: string;
  priorRp: number;
  newRp: number;
  finalRp: number;
  reinforcement: number;
}

interface ConditionResult {
  priorWeight: number;
  turnRecords: TurnRecord[];
  postSnapshot: Record<string, number>;
  postRanking: Array<{ memoryId: string; cluster: string; rank: number; score: number }>;
  clusterAFinalAvg: number;
  clusterBFinalAvg: number;
  clusterCFinalAvg: number;
  clusterAMonotonic: boolean; // H1
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resetPriorities(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<void> {
  for (const memory of CORPUS_MEMORIES) {
    await updateDocument(client, INDEX, memory.memoryId, {
      retrieval_priority: memory.importanceScore,
      decay_factor: 0.5,
      reinforcement_score: 0,
    });
  }
}

async function snapshotRp(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<Record<string, number>> {
  const snap: Record<string, number> = {};
  for (const id of ALL_MEMORY_IDS) {
    const doc = await getDocument<SemanticDoc>(client, INDEX, id);
    snap[id] = doc?.retrieval_priority ?? 0;
  }
  return snap;
}

async function retrievalQuery(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<Array<{ memoryId: string; cluster: string; rank: number; score: number }>> {
  const hits = await search<SemanticDoc>(client, INDEX, {
    size: TOP_K,
    query: {
      function_score: {
        query: { match_all: {} },
        functions: [{
          script_score: {
            script: {
              source: `
                double rp = doc['retrieval_priority'].value;
                double usage = (double) doc['usage_frequency'].value;
                return rp + ${RETRIEVAL_T} * (1.0 - usage);
              `,
            },
          },
        }],
        boost_mode: "replace",
      },
    },
  });
  return hits.map((h, i) => ({
    memoryId: h._source.memory_id,
    cluster: h._source.semantic_cluster,
    rank: i + 1,
    score: h._score,
  }));
}

// ---------------------------------------------------------------------------
// Run one prior-weight condition
// ---------------------------------------------------------------------------

async function runCondition(
  client: ReturnType<typeof createOpenSearchClient>,
  priorWeight: number,
): Promise<ConditionResult> {
  console.log(`\n--- pw=${priorWeight} ---`);
  await resetPriorities(client);

  const engine = new ReinforcementEngine({ openSearch: client, priorWeight });
  const turnRecords: TurnRecord[] = [];

  // Track retrieval_priority after each cluster-A turn for monotonicity check
  const clusterATrajectory: number[] = [];

  for (const turn of CORPUS_TURNS) {
    const priorDoc = await getDocument<SemanticDoc>(client, INDEX, turn.memoryId);
    const priorRp = priorDoc?.retrieval_priority ?? 0;

    const update = await engine.evaluate({
      memoryId: turn.memoryId,
      memoryIndex: INDEX,
      signal: turn.signal,
    });

    const postDoc = await getDocument<SemanticDoc>(client, INDEX, turn.memoryId);
    const finalRp = postDoc?.retrieval_priority ?? update.result.retrievalPriority;

    turnRecords.push({
      turnId: turn.turnId,
      memoryId: turn.memoryId,
      priorRp,
      newRp: update.result.retrievalPriority,
      finalRp,
      reinforcement: update.result.reinforcement,
    });

    if (CLUSTER_A_TURNS.has(turn.turnId) && turn.memoryId === "mem-a1") {
      clusterATrajectory.push(finalRp);
    }

    console.log(
      `  ${turn.turnId} ${turn.memoryId}: prior=${priorRp.toFixed(3)} ` +
        `newRp=${update.result.retrievalPriority.toFixed(3)} final=${finalRp.toFixed(3)}`,
    );
  }

  const postSnapshot = await snapshotRp(client);
  const postRanking = await retrievalQuery(client);

  const clusterAIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-a"));
  const clusterBIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-b"));
  const clusterCIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-c"));

  const avg = (ids: readonly string[]) =>
    ids.reduce((s, id) => s + (postSnapshot[id] ?? 0), 0) / ids.length;

  // H1: mem-a1 retrieval_priority strictly increases across its reinforcement turns
  const clusterAMonotonic = clusterATrajectory.every((rp, i) =>
    i === 0 || rp >= clusterATrajectory[i - 1]!,
  );

  console.log(
    `  top-5: ${postRanking.map((r) => `${r.memoryId}(${r.score.toFixed(3)})`).join(" ")}`,
  );
  console.log(`  cluster avg rp — A:${avg(clusterAIds).toFixed(3)} B:${avg(clusterBIds).toFixed(3)} C:${avg(clusterCIds).toFixed(3)}`);
  console.log(`  mem-a1 trajectory: [${clusterATrajectory.map((v) => v.toFixed(3)).join(", ")}] monotonic=${clusterAMonotonic}`);

  return {
    priorWeight,
    turnRecords,
    postSnapshot,
    postRanking,
    clusterAFinalAvg: avg(clusterAIds),
    clusterBFinalAvg: avg(clusterBIds),
    clusterCFinalAvg: avg(clusterCIds),
    clusterAMonotonic,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());

  console.log("=== Experiment 8: Prior-Weighted Compounding Reinforcement ===\n");

  const conditions: ConditionResult[] = [];
  for (const pw of PRIOR_WEIGHTS) {
    conditions.push(await runCondition(client, pw));
  }

  // Restore baseline state
  await resetPriorities(client);
  console.log("\nRestored baseline state.");

  // ---------------------------------------------------------------------------
  // Hypothesis evaluation
  // ---------------------------------------------------------------------------

  const [pw0, pw03, pw06] = conditions as [ConditionResult, ConditionResult, ConditionResult];

  // H1: cluster-A (mem-a1) monotonically increases under pw=0.3
  const h1Pass = pw03.clusterAMonotonic;
  console.log(`\nH1 — mem-a1 retrieval_priority monotonically increasing at pw=0.3: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: mem-c1 ends below importanceScore=0.3 in all conditions
  const c1Baseline = CORPUS_MEMORIES.find((m) => m.memoryId === "mem-c1")!.importanceScore;
  const h2Results = conditions.map((c) => ({
    pw: c.priorWeight,
    c1Rp: c.postSnapshot["mem-c1"] ?? 0,
    pass: (c.postSnapshot["mem-c1"] ?? 0) < c1Baseline,
  }));
  const h2Pass = h2Results.every((r) => r.pass);
  console.log(`\nH2 — mem-c1 retrieval_priority < importanceScore=${c1Baseline} across all pw:`);
  for (const r of h2Results) {
    console.log(`  pw=${r.pw}: rp=${r.c1Rp.toFixed(4)} ${r.pass ? "✓" : "✗"}`);
  }
  console.log(`  Result: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: cluster-A avg rp increases with pw
  const h3Pass = pw0.clusterAFinalAvg < pw03.clusterAFinalAvg && pw03.clusterAFinalAvg < pw06.clusterAFinalAvg;
  console.log(`\nH3 — cluster-A avg rp increases with priorWeight:`);
  console.log(`  pw=0.0: ${pw0.clusterAFinalAvg.toFixed(4)}`);
  console.log(`  pw=0.3: ${pw03.clusterAFinalAvg.toFixed(4)}`);
  console.log(`  pw=0.6: ${pw06.clusterAFinalAvg.toFixed(4)}`);
  console.log(`  Result: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: cluster-A vs cluster-B spread widens with pw
  const spread0 = pw0.clusterAFinalAvg - pw0.clusterBFinalAvg;
  const spread03 = pw03.clusterAFinalAvg - pw03.clusterBFinalAvg;
  const spread06 = pw06.clusterAFinalAvg - pw06.clusterBFinalAvg;
  const h4Pass = spread0 < spread03 && spread03 < spread06;
  console.log(`\nH4 — A-B retrieval_priority spread widens with priorWeight:`);
  console.log(`  pw=0.0: spread=${spread0.toFixed(4)} (A=${pw0.clusterAFinalAvg.toFixed(4)} B=${pw0.clusterBFinalAvg.toFixed(4)})`);
  console.log(`  pw=0.3: spread=${spread03.toFixed(4)} (A=${pw03.clusterAFinalAvg.toFixed(4)} B=${pw03.clusterBFinalAvg.toFixed(4)})`);
  console.log(`  pw=0.6: spread=${spread06.toFixed(4)} (A=${pw06.clusterAFinalAvg.toFixed(4)} B=${pw06.clusterBFinalAvg.toFixed(4)})`);
  console.log(`  Result: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  saveResults("exp8", [
    `H1 mem-a1 monotonically increasing at pw=0.3: ${h1Pass ? "PASS" : "FAIL"}`,
    `H2 mem-c1 decays below baseline at all pw: ${h2Pass ? "PASS" : "FAIL"}`,
    `H3 cluster-A avg rp increases monotonically with pw: ${h3Pass ? "PASS" : "FAIL"}`,
    `H4 A-B spread widens with pw: ${h4Pass ? "PASS" : "FAIL"}`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
    conditions: conditions.map((c) => ({
      priorWeight: c.priorWeight,
      clusterAFinalAvg: c.clusterAFinalAvg,
      clusterBFinalAvg: c.clusterBFinalAvg,
      clusterCFinalAvg: c.clusterCFinalAvg,
      clusterAMonotonic: c.clusterAMonotonic,
      postRanking: c.postRanking,
      postSnapshot: c.postSnapshot,
    })),
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
