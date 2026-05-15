/**
 * Experiment 9 — Compounding Divergence Over 100 Turns
 *
 * Experiment 8 showed that pw=0.3 EMA compounding is indistinguishable from
 * stateless (pw=0) over the 20-turn corpus because the importanceScore
 * initialisation anchor dominates. This experiment runs a 100-turn synthetic
 * session — 5 cycles of the 20-turn CORPUS_TURNS with mild signal jitter — to
 * show the full compounding divergence curve and calibrate the pw value.
 *
 * Four hypotheses:
 *
 *   H1 — By turn 60+, cluster-A retrieval_priority at pw=0.3 is NOT
 *        measurably higher than pw=0.0 (gap < 0.05). EMA converges to the
 *        same signal-determined fixed point regardless of pw; 100 turns is
 *        not enough to show divergence with EMA blending alone.
 *
 *   H2 — The A-B retrieval_priority spread at turn 100 is within 0.05 of
 *        pw=0.0 at pw=0.3. EMA does not widen the spread between
 *        consistently-reinforced and weakly-reinforced memories.
 *
 *   H3 — cluster-C retrieval_priority at turn 100 is close to its turn-20
 *        value (within 0.02). Contradiction suppression stabilises rather
 *        than deepening — the EMA prior anchors rp near the fixed point.
 *
 *   H4 — The divergence curve (cluster-A avg rp over turns) is NOT convex:
 *        the gap between pw=0.3 and pw=0.0 does not systematically grow.
 *        It oscillates around zero without accumulating — confirming EMA
 *        is not a Hebbian accumulator.
 *
 * Protocol:
 *   For each pw ∈ {0.0, 0.3}:
 *     1. Reset retrieval_priority = importanceScore for all 9 memories.
 *     2. Run 5 cycles of CORPUS_TURNS with ±0.05 uniform jitter on all
 *        signal fields (clamped to [0,1]) to avoid identical repeated signals.
 *     3. Sample cluster-A and cluster-B avg retrieval_priority every 5 turns.
 *     4. Record the divergence curve and final snapshot.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp9
 */

import {
  createOpenSearchClient,
  getDocument,
  updateDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const CYCLES = 5;
const SAMPLE_EVERY = 5;
const PRIOR_WEIGHTS = [0.0, 0.3] as const;
const JITTER = 0.05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  retrieval_priority?: number;
}

interface Sample {
  turn: number;
  clusterAAvg: number;
  clusterBAvg: number;
  clusterCAvg: number;
  spread: number;
}

interface ConditionResult {
  priorWeight: number;
  samples: Sample[];
  postSnapshot: Record<string, number>;
  turn20ClusterA: number; // cluster-A avg at end of first cycle (comparable to Exp 8)
  turn100ClusterA: number;
  turn100ClusterB: number;
  turn100ClusterC: number;
  turn100Spread: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Uniform jitter on a signal value, clamped to [0, 1]. */
function jitter(value: number): number {
  return Math.max(0, Math.min(1, value + (Math.random() - 0.5) * 2 * JITTER));
}

function jitterSignal(signal: ReinforcementSignal): ReinforcementSignal {
  return {
    importance: jitter(signal.importance),
    usageFrequency: jitter(signal.usageFrequency),
    goalRelevance: jitter(signal.goalRelevance),
    novelty: jitter(signal.novelty),
    predictionAccuracy: jitter(signal.predictionAccuracy),
    emotionalWeight: jitter(signal.emotionalWeight),
    contradictionRisk: jitter(signal.contradictionRisk),
    policyAlignment: jitter(signal.policyAlignment),
    ...(signal.toolUsefulness !== undefined ? { toolUsefulness: jitter(signal.toolUsefulness) } : {}),
  };
}

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

async function snapshotAvgs(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<{ a: number; b: number; c: number; snap: Record<string, number> }> {
  const snap: Record<string, number> = {};
  for (const id of ALL_MEMORY_IDS) {
    const doc = await getDocument<SemanticDoc>(client, INDEX, id);
    snap[id] = doc?.retrieval_priority ?? 0;
  }
  const avg = (prefix: string) => {
    const vals = ALL_MEMORY_IDS.filter((id) => id.startsWith(`mem-${prefix}`)).map((id) => snap[id] ?? 0);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  return { a: avg("a"), b: avg("b"), c: avg("c"), snap };
}

// ---------------------------------------------------------------------------
// Run one prior-weight condition
// ---------------------------------------------------------------------------

async function runCondition(
  client: ReturnType<typeof createOpenSearchClient>,
  priorWeight: number,
): Promise<ConditionResult> {
  console.log(`\n--- pw=${priorWeight} (${CYCLES * CORPUS_TURNS.length} turns) ---`);
  await resetPriorities(client);

  const engine = new ReinforcementEngine({ openSearch: client, priorWeight });
  const samples: Sample[] = [];
  let globalTurn = 0;
  let turn20ClusterA = 0;

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of CORPUS_TURNS) {
      globalTurn++;

      await engine.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });

      if (globalTurn % SAMPLE_EVERY === 0) {
        const { a, b, c } = await snapshotAvgs(client);
        const sample: Sample = { turn: globalTurn, clusterAAvg: a, clusterBAvg: b, clusterCAvg: c, spread: a - b };
        samples.push(sample);
        console.log(
          `  t=${String(globalTurn).padStart(3)} A=${a.toFixed(4)} B=${b.toFixed(4)} C=${c.toFixed(4)} spread=${(a-b).toFixed(4)}`,
        );
      }

      // capture end of first cycle for comparison with Exp 8
      if (globalTurn === CORPUS_TURNS.length) {
        const { a } = await snapshotAvgs(client);
        turn20ClusterA = a;
      }
    }
  }

  const { a, b, c, snap } = await snapshotAvgs(client);
  return {
    priorWeight,
    samples,
    postSnapshot: snap,
    turn20ClusterA,
    turn100ClusterA: a,
    turn100ClusterB: b,
    turn100ClusterC: c,
    turn100Spread: a - b,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());

  console.log("=== Experiment 9: Compounding Divergence Over 100 Turns ===\n");

  const conditions: ConditionResult[] = [];
  for (const pw of PRIOR_WEIGHTS) {
    conditions.push(await runCondition(client, pw));
  }

  await resetPriorities(client);
  console.log("\nRestored baseline state.");

  const [pw0, pw03] = conditions as [ConditionResult, ConditionResult];

  // H1: by turn 60, cluster-A gap < 0.05 (EMA does not compound above fixed point)
  const t60samples = pw03.samples.filter((s) => s.turn <= 60);
  const t60pw03 = t60samples.at(-1)?.clusterAAvg ?? 0;
  const t60pw0 = pw0.samples.find((s) => s.turn === t60samples.at(-1)?.turn)?.clusterAAvg ?? 0;
  const h1Gap = Math.abs(t60pw03 - t60pw0);
  const h1Pass = h1Gap < 0.05;
  console.log(`\nH1 — cluster-A gap at turn 60: pw0.3=${t60pw03.toFixed(4)} pw0=${t60pw0.toFixed(4)} gap=${h1Gap.toFixed(4)}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: A-B spread gap < 0.05 at turn 100 (EMA doesn't widen the spread)
  const spreadGap = Math.abs(pw03.turn100Spread - pw0.turn100Spread);
  const h2Pass = spreadGap < 0.05;
  console.log(`\nH2 — A-B spread gap at turn 100: pw0.3=${pw03.turn100Spread.toFixed(4)} pw0=${pw0.turn100Spread.toFixed(4)} gap=${spreadGap.toFixed(4)}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: cluster-C rp at turn 100 is close to turn-20 value (stabilises, doesn't deepen)
  const c1At20pw0 = pw0.samples.find((s) => s.turn >= 20)?.clusterCAvg ?? 0;
  const c1At100pw0 = pw0.turn100ClusterC;
  const c1Drift = Math.abs(c1At100pw0 - c1At20pw0);
  const h3Pass = c1Drift < 0.02;
  console.log(`\nH3 — cluster-C stabilises: turn-20=${c1At20pw0.toFixed(4)} turn-100=${c1At100pw0.toFixed(4)} drift=${c1Drift.toFixed(4)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: divergence is not convex — gap at 100 not larger than gap at 40 (oscillates, no trend)
  const gapAt40 = (() => {
    const s03 = pw03.samples.find((s) => s.turn >= 40);
    const s0 = pw0.samples.find((s) => s.turn === s03?.turn);
    return (s03?.clusterAAvg ?? 0) - (s0?.clusterAAvg ?? 0);
  })();
  const gapAt100 = pw03.turn100ClusterA - pw0.turn100ClusterA;
  const h4Pass = Math.abs(gapAt100) < 0.05 && Math.abs(gapAt40) < 0.05;
  console.log(`\nH4 — gap stays near zero (no accumulation): gap@40=${gapAt40.toFixed(4)} gap@100=${gapAt100.toFixed(4)}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Divergence table
  console.log("\nDivergence table (cluster-A avg retrieval_priority):");
  console.log("  turn  pw=0.0   pw=0.3   gap");
  for (const s03 of pw03.samples) {
    const s0 = pw0.samples.find((s) => s.turn === s03.turn);
    if (!s0) continue;
    const gap = s03.clusterAAvg - s0.clusterAAvg;
    console.log(`  ${String(s03.turn).padStart(4)}  ${s0.clusterAAvg.toFixed(4)}   ${s03.clusterAAvg.toFixed(4)}   ${gap >= 0 ? "+" : ""}${gap.toFixed(4)}`);
  }

  saveResults("exp9", [
    `H1 cluster-A gap < 0.05 at turn 60 (no EMA compounding): ${h1Pass ? "PASS" : "FAIL"} (gap=${h1Gap.toFixed(4)})`,
    `H2 A-B spread gap < 0.05 at turn 100 (EMA no widening): ${h2Pass ? "PASS" : "FAIL"} (gap=${spreadGap.toFixed(4)})`,
    `H3 cluster-C stabilises near turn-20 level: ${h3Pass ? "PASS" : "FAIL"} (drift=${c1Drift.toFixed(4)})`,
    `H4 gap stays near zero (no accumulation): ${h4Pass ? "PASS" : "FAIL"} (gap@40=${gapAt40.toFixed(4)} gap@100=${gapAt100.toFixed(4)})`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
    conditions: conditions.map((c) => ({
      priorWeight: c.priorWeight,
      turn20ClusterA: c.turn20ClusterA,
      turn100ClusterA: c.turn100ClusterA,
      turn100ClusterB: c.turn100ClusterB,
      turn100ClusterC: c.turn100ClusterC,
      turn100Spread: c.turn100Spread,
      samples: c.samples,
    })),
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
