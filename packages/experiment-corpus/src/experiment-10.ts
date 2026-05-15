/**
 * Experiment 10 — Hebbian Count-Bonus Compounding
 *
 * Experiments 8–9 showed that EMA prior-weighting converges to a
 * signal-determined fixed point: no true compounding occurs because priorWeight
 * only controls convergence speed, not the fixed point itself.
 *
 * This experiment validates the fix: a `reinforcement_count` field that
 * increments per evaluation plus a `log2(1 + count) × countBonus` term added
 * to retrieval_priority. This shifts the fixed point upward with each positive
 * evaluation — mirroring biological long-term potentiation — and produces
 * genuine divergence between consistently-reinforced and weakly-reinforced
 * memories over a long session.
 *
 * Three conditions over 100 turns (5 × 20-turn corpus with ±0.05 jitter):
 *   cb=0.00  — stateless baseline (Exp 7/9 behaviour)
 *   cb=0.02  — mild Hebbian bonus
 *   cb=0.05  — strong Hebbian bonus
 *
 * Four hypotheses:
 *
 *   H1 — By turn 60, cluster-A avg retrieval_priority at cb=0.02 exceeds
 *        cb=0.0 by > 0 (any positive gap). The count bonus lifts
 *        consistently-reinforced memories above the signal fixed point —
 *        compounding is real even if the absolute magnitude is modest.
 *
 *   H2 — The A-B spread at turn 100 is wider at cb=0.02 than cb=0.0.
 *        Cluster-A (10 reinforcement turns per cycle) compounds faster than
 *        cluster-B (4 turns per cycle), producing a positive spread gap.
 *
 *   H3 — mem-c1 retrieval_priority at turn 100 remains below its
 *        importanceScore=0.30 baseline under all countBonus settings.
 *        The quality-gated count bonus cannot lift a memory whose base
 *        reinforcement score is consistently low.
 *
 *   H4 — The divergence curve at cb=0.02 is non-decreasing: the gap between
 *        cb=0.02 and cb=0.0 at turn 100 is ≥ gap at turn 40. The log2 count
 *        bonus accumulates over time rather than plateauing immediately.
 *
 * Protocol:
 *   1. Patch the live memory_semantic index to add reinforcement_count field.
 *   2. Reset all corpus documents: retrieval_priority=importanceScore, count=0.
 *   3. For each countBonus ∈ {0.0, 0.02, 0.05}:
 *      a. Reset documents.
 *      b. Run 100 turns, sampling cluster avgs every 10 turns.
 *      c. Record count trajectories for mem-a1 and mem-b1.
 *   4. Compare divergence curves and test hypotheses.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp10
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
const SAMPLE_EVERY = 10;
const COUNT_BONUSES = [0.0, 0.02, 0.05] as const;
const JITTER = 0.05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  retrieval_priority?: number;
  reinforcement_count?: number;
}

interface Sample {
  turn: number;
  clusterAAvg: number;
  clusterBAvg: number;
  clusterCAvg: number;
  spread: number;
  memA1Rp: number;
  memA1Count: number;
  memB1Rp: number;
  memB1Count: number;
}

interface ConditionResult {
  countBonus: number;
  samples: Sample[];
  turn100ClusterA: number;
  turn100ClusterB: number;
  turn100ClusterC: number;
  turn100Spread: number;
  memA1FinalRp: number;
  memA1FinalCount: number;
  memC1FinalRp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function resetAll(client: ReturnType<typeof createOpenSearchClient>): Promise<void> {
  for (const memory of CORPUS_MEMORIES) {
    await updateDocument(client, INDEX, memory.memoryId, {
      retrieval_priority: memory.importanceScore,
      decay_factor: 0.5,
      reinforcement_score: 0,
      reinforcement_count: 0,
    });
  }
}

async function sampleState(
  client: ReturnType<typeof createOpenSearchClient>,
  turn: number,
): Promise<Sample> {
  const docs = new Map<string, SemanticDoc>();
  for (const id of ALL_MEMORY_IDS) {
    const doc = await getDocument<SemanticDoc>(client, INDEX, id);
    if (doc) docs.set(id, doc);
  }

  const avg = (prefix: string) => {
    const ids = ALL_MEMORY_IDS.filter((id) => id.startsWith(`mem-${prefix}`));
    return ids.reduce((s, id) => s + (docs.get(id)?.retrieval_priority ?? 0), 0) / ids.length;
  };

  const a1 = docs.get("mem-a1");
  const b1 = docs.get("mem-b1");
  const clusterAAvg = avg("a");
  const clusterBAvg = avg("b");

  return {
    turn,
    clusterAAvg,
    clusterBAvg,
    clusterCAvg: avg("c"),
    spread: clusterAAvg - clusterBAvg,
    memA1Rp: a1?.retrieval_priority ?? 0,
    memA1Count: a1?.reinforcement_count ?? 0,
    memB1Rp: b1?.retrieval_priority ?? 0,
    memB1Count: b1?.reinforcement_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Run one condition
// ---------------------------------------------------------------------------

async function runCondition(
  client: ReturnType<typeof createOpenSearchClient>,
  countBonus: number,
): Promise<ConditionResult> {
  console.log(`\n--- cb=${countBonus} (${CYCLES * CORPUS_TURNS.length} turns) ---`);
  await resetAll(client);

  const engine = new ReinforcementEngine({ openSearch: client, countBonus });
  const samples: Sample[] = [];
  let globalTurn = 0;

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of CORPUS_TURNS) {
      globalTurn++;
      await engine.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });

      if (globalTurn % SAMPLE_EVERY === 0) {
        const s = await sampleState(client, globalTurn);
        samples.push(s);
        console.log(
          `  t=${String(globalTurn).padStart(3)}  A=${s.clusterAAvg.toFixed(4)}  B=${s.clusterBAvg.toFixed(4)}` +
            `  C=${s.clusterCAvg.toFixed(4)}  spread=${s.spread.toFixed(4)}` +
            `  a1=[rp=${s.memA1Rp.toFixed(3)},n=${s.memA1Count}]  b1=[rp=${s.memB1Rp.toFixed(3)},n=${s.memB1Count}]`,
        );
      }
    }
  }

  const final = samples.at(-1)!;
  const c1Doc = await getDocument<SemanticDoc>(client, INDEX, "mem-c1");
  const a1Doc = await getDocument<SemanticDoc>(client, INDEX, "mem-a1");

  return {
    countBonus,
    samples,
    turn100ClusterA: final.clusterAAvg,
    turn100ClusterB: final.clusterBAvg,
    turn100ClusterC: final.clusterCAvg,
    turn100Spread: final.spread,
    memA1FinalRp: a1Doc?.retrieval_priority ?? 0,
    memA1FinalCount: a1Doc?.reinforcement_count ?? 0,
    memC1FinalRp: c1Doc?.retrieval_priority ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 10: Hebbian Count-Bonus Compounding ===\n");

  // Patch the live index to accept reinforcement_count if not already present
  const osUrl = process.env["OPENSEARCH_URL"] ?? "http://localhost:9200";
  const patchRes = await fetch(`${osUrl}/memory_semantic/_mapping`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { reinforcement_count: { type: "integer" } } }),
  });
  console.log(`Index mapping patch: ${patchRes.status} ${patchRes.statusText}`);

  const conditions: ConditionResult[] = [];
  for (const cb of COUNT_BONUSES) {
    conditions.push(await runCondition(client, cb));
  }

  await resetAll(client);
  console.log("\nRestored baseline state.");

  const [cb0, cb02, cb05] = conditions as [ConditionResult, ConditionResult, ConditionResult];

  // H1: cluster-A at cb=0.02 exceeds cb=0.0 at turn 60 (any positive gap confirms compounding)
  const t60_cb0  = cb0.samples.find((s) => s.turn >= 60)?.clusterAAvg ?? 0;
  const t60_cb02 = cb02.samples.find((s) => s.turn >= 60)?.clusterAAvg ?? 0;
  const h1Gap = t60_cb02 - t60_cb0;
  const h1Pass = h1Gap > 0;
  console.log(`\nH1 — cluster-A gap at t=60: cb0=${t60_cb0.toFixed(4)} cb0.02=${t60_cb02.toFixed(4)} gap=${h1Gap.toFixed(4)}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: A-B spread wider at cb=0.02 than cb=0.0 at turn 100 (any positive gap)
  const spreadGap = cb02.turn100Spread - cb0.turn100Spread;
  const h2Pass = spreadGap > 0;
  console.log(`\nH2 — A-B spread gap at t=100: cb0=${cb0.turn100Spread.toFixed(4)} cb0.02=${cb02.turn100Spread.toFixed(4)} gap=${spreadGap.toFixed(4)}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: mem-c1 below importanceScore=0.30 at all cb
  const c1Baseline = CORPUS_MEMORIES.find((m) => m.memoryId === "mem-c1")!.importanceScore;
  const h3Results = conditions.map((c) => ({ cb: c.countBonus, rp: c.memC1FinalRp, pass: c.memC1FinalRp < c1Baseline }));
  const h3Pass = h3Results.every((r) => r.pass);
  console.log(`\nH3 — mem-c1 rp < ${c1Baseline} at all cb:`);
  for (const r of h3Results) console.log(`  cb=${r.cb}: rp=${r.rp.toFixed(4)} ${r.pass ? "✓" : "✗"}`);
  console.log(`  Result: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: gap non-decreasing — cb=0.02 gap at turn 100 ≥ gap at turn 40
  const gapAt40  = (cb02.samples.find((s) => s.turn >= 40)?.clusterAAvg  ?? 0)
                 - (cb0.samples.find((s)  => s.turn >= 40)?.clusterAAvg  ?? 0);
  const gapAt100 = cb02.turn100ClusterA - cb0.turn100ClusterA;
  const h4Pass = gapAt100 >= gapAt40;
  console.log(`\nH4 — gap non-decreasing: gap@40=${gapAt40.toFixed(4)} gap@100=${gapAt100.toFixed(4)}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Divergence table
  console.log("\nDivergence table — cluster-A avg retrieval_priority:");
  console.log("  turn    cb=0.00   cb=0.02   cb=0.05   gap(02-00)");
  for (const s02 of cb02.samples) {
    const s0  = cb0.samples.find((s) => s.turn === s02.turn);
    const s05 = cb05.samples.find((s) => s.turn === s02.turn);
    if (!s0 || !s05) continue;
    const gap = s02.clusterAAvg - s0.clusterAAvg;
    console.log(
      `  ${String(s02.turn).padStart(4)}    ${s0.clusterAAvg.toFixed(4)}    ${s02.clusterAAvg.toFixed(4)}    ${s05.clusterAAvg.toFixed(4)}    ${gap >= 0 ? "+" : ""}${gap.toFixed(4)}`,
    );
  }

  console.log(`\nmem-a1 at turn 100:`);
  for (const c of conditions) {
    console.log(`  cb=${c.countBonus}: rp=${c.memA1FinalRp.toFixed(4)} count=${c.memA1FinalCount}`);
  }

  saveResults("exp10", [
    `H1 cluster-A cb0.02 > cb0 at turn 60 (compounding positive): ${h1Pass ? "PASS" : "FAIL"} (gap=${h1Gap.toFixed(4)})`,
    `H2 A-B spread wider at cb0.02 than cb0 at turn 100: ${h2Pass ? "PASS" : "FAIL"} (gap=${spreadGap.toFixed(4)})`,
    `H3 mem-c1 below importanceScore at all cb: ${h3Pass ? "PASS" : "FAIL"}`,
    `H4 gap non-decreasing (accumulates over time): ${h4Pass ? "PASS" : "FAIL"} (gap@40=${gapAt40.toFixed(4)} gap@100=${gapAt100.toFixed(4)})`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
    conditions: conditions.map((c) => ({
      countBonus: c.countBonus,
      turn100ClusterA: c.turn100ClusterA,
      turn100ClusterB: c.turn100ClusterB,
      turn100ClusterC: c.turn100ClusterC,
      turn100Spread: c.turn100Spread,
      memA1FinalRp: c.memA1FinalRp,
      memA1FinalCount: c.memA1FinalCount,
      memC1FinalRp: c.memC1FinalRp,
      samples: c.samples,
    })),
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
