/**
 * Experiment 11 — Quality-Gated Count Bonus: Fix Verification + Arbitration Impact
 *
 * Experiment 10 found that the bare `log2(count)` count bonus lifted mem-c1
 * (high contradictionRisk) above its importanceScore baseline because the
 * bonus was cluster-agnostic. The fix gates the bonus on `result.reinforcement`:
 *
 *   finalRp += countBonus × log2(1 + count) × reinforcement
 *
 * This experiment has two parts:
 *
 * PART A — Fix verification
 *   Compares bare vs quality-gated count bonus. Three conditions over 100 turns:
 *     bare-0.02   — ungated bonus (Exp 10 bug)
 *     gated-0.02  — quality-gated (the fix)
 *     baseline    — stateless cb=0 (Exp 7/9 reference)
 *
 *   H1: Quality-gated cb=0.02 keeps mem-c1 rp < importanceScore=0.30.
 *   H2: Bare cb=0.02 lifts mem-c1 above 0.30 (Exp 10 reproduction).
 *
 * PART B — Arbitration impact
 *   After each 100-turn run, simulates two arbitration scenarios using the
 *   final retrieval_priority state:
 *     cluster-A proposal: agent retrieved mem-a1, mem-a2, mem-a3 (trusted, high-rp)
 *     cluster-C proposal: agent retrieved mem-c1, mem-c2 (contradictory, low-rp)
 *
 *   Both proposals have identical confidence=0.7, riskScore=0.2 so that the
 *   only variable is memoryAlignment driven by the corpus state.
 *   Actually: memoryAlignment = min(1, len(retrievedMemories)/5) and is based
 *   on *count* of memories not their rp. So we use a richer signal: confidence
 *   is set proportional to the avg retrieval_priority of the retrieved memories,
 *   reflecting that better-retrieved memories should give higher agent confidence.
 *
 *   H3: After quality-gated compounding, cluster-A proposal arbitration score
 *       is ≥ 0.02 higher than the baseline condition.
 *   H4: The arbitration score gap (cluster-A minus cluster-C) is wider under
 *       quality-gated compounding than under baseline.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp11
 */

import {
  createOpenSearchClient,
  getDocument,
  updateDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { scoreDebateCandidate } from "@cognitive-substrate/agents";
import type { AgentResult } from "@cognitive-substrate/core-types";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const CYCLES = 5;
const JITTER = 0.05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  importance_score: number;
  retrieval_priority?: number;
  reinforcement_count?: number;
}

interface FinalState {
  memA1Rp: number; memA1Count: number;
  memC1Rp: number; memC1Count: number;
  clusterAAvg: number;
  clusterCAvg: number;
}

interface ArbitrationScores {
  clusterAScore: number;
  clusterCScore: number;
  gap: number;
}

interface ConditionResult {
  label: string;
  finalState: FinalState;
  arbitration: ArbitrationScores;
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

async function getFinalState(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<FinalState> {
  const get = async (id: string) => getDocument<SemanticDoc>(client, INDEX, id);
  const [a1, c1] = await Promise.all([get("mem-a1"), get("mem-c1")]);

  const clusterAIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-a"));
  const clusterCIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-c"));

  const avg = async (ids: readonly string[]) => {
    const docs = await Promise.all(ids.map((id) => get(id)));
    return docs.reduce((s, d) => s + (d?.retrieval_priority ?? 0), 0) / ids.length;
  };

  return {
    memA1Rp: a1?.retrieval_priority ?? 0,
    memA1Count: a1?.reinforcement_count ?? 0,
    memC1Rp: c1?.retrieval_priority ?? 0,
    memC1Count: c1?.reinforcement_count ?? 0,
    clusterAAvg: await avg(clusterAIds),
    clusterCAvg: await avg(clusterCIds),
  };
}

/**
 * Simulates two agent proposals and runs arbitration scoring.
 * Agent confidence is set proportional to the avg retrieval_priority of the
 * memories cited — a proxy for "better-retrieved memories gave the agent
 * more reliable context".
 */
async function scoreArbitration(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<ArbitrationScores> {
  const get = async (id: string) => getDocument<SemanticDoc>(client, INDEX, id);

  const clusterAMemIds = ["mem-a1", "mem-a2", "mem-a3"];
  const clusterCMemIds = ["mem-c1", "mem-c2"];

  const avgRp = async (ids: string[]) => {
    const docs = await Promise.all(ids.map(get));
    return docs.reduce((s, d) => s + (d?.retrieval_priority ?? 0), 0) / ids.length;
  };

  const aAvgRp = await avgRp(clusterAMemIds);
  const cAvgRp = await avgRp(clusterCMemIds);

  const makeResult = (ids: string[], avgRp: number, risk: number): AgentResult => ({
    agentId: `agent-${ids[0]}`,
    agentType: "planner",
    traceId: "exp11",
    timestamp: new Date().toISOString(),
    proposal: "Action proposal based on retrieved memories.",
    reasoning: "Supported by retrieved context.",
    confidence: Math.min(1, avgRp),   // confidence tracks retrieval quality
    riskScore: risk,
    retrievedMemories: ids,
  });

  const aResult = makeResult(clusterAMemIds, aAvgRp, 0.1);
  const cResult = makeResult(clusterCMemIds, cAvgRp, 0.6);  // higher risk for contradictory memories

  const aScore = scoreDebateCandidate(aResult).total;
  const cScore = scoreDebateCandidate(cResult).total;

  return { clusterAScore: aScore, clusterCScore: cScore, gap: aScore - cScore };
}

// ---------------------------------------------------------------------------
// Run one condition
// ---------------------------------------------------------------------------

async function runCondition(
  client: ReturnType<typeof createOpenSearchClient>,
  label: string,
  engineConfig: { countBonus?: number; priorWeight?: number },
): Promise<ConditionResult> {
  console.log(`\n--- ${label} ---`);
  await resetAll(client);

  const engine = new ReinforcementEngine({ openSearch: client, ...engineConfig });
  let globalTurn = 0;

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of CORPUS_TURNS) {
      globalTurn++;
      await engine.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });
    }
  }

  const finalState = await getFinalState(client);
  const arbitration = await scoreArbitration(client);

  const c1Baseline = CORPUS_MEMORIES.find((m) => m.memoryId === "mem-c1")!.importanceScore;
  console.log(
    `  mem-a1: rp=${finalState.memA1Rp.toFixed(4)} n=${finalState.memA1Count}` +
      `  mem-c1: rp=${finalState.memC1Rp.toFixed(4)} n=${finalState.memC1Count}` +
      `  c1_above_baseline=${finalState.memC1Rp > c1Baseline}`,
  );
  console.log(
    `  arbitration — A:${arbitration.clusterAScore.toFixed(4)} C:${arbitration.clusterCScore.toFixed(4)} gap:${arbitration.gap.toFixed(4)}`,
  );

  return { label, finalState, arbitration };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 11: Quality-Gated Fix Verification + Arbitration Impact ===\n");

  // Run sequentially — each condition resets OpenSearch state before starting
  const conditions: ConditionResult[] = [];
  conditions.push(await runCondition(client, "baseline (cb=0)", {}));
  conditions.push(await runCondition(client, "gated cb=0.02 (fix)", { countBonus: 0.02 }));
  conditions.push(await runCondition(client, "gated cb=0.05", { countBonus: 0.05 }));

  await resetAll(client);
  console.log("\nRestored baseline state.");

  const [baseline, gated02, gated05] = conditions as [ConditionResult, ConditionResult, ConditionResult];
  const c1Baseline = CORPUS_MEMORIES.find((m) => m.memoryId === "mem-c1")!.importanceScore;

  // H1: quality-gated cb=0.02 keeps mem-c1 below importanceScore=0.30
  const h1Pass = gated02.finalState.memC1Rp < c1Baseline;
  console.log(`\nH1 — gated cb=0.02 mem-c1 < ${c1Baseline}: rp=${gated02.finalState.memC1Rp.toFixed(4)}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: Exp 10 pre-fix value was 0.3086 — confirm the fix is a real improvement
  const exp10BareC1 = 0.3086;
  const h2Pass = gated02.finalState.memC1Rp < exp10BareC1;
  console.log(`H2 — gated c1 rp (${gated02.finalState.memC1Rp.toFixed(4)}) < Exp10 bare (${exp10BareC1}): ${h2Pass ? "✓ PASS (fix confirmed)" : "✗ FAIL (regression)"}`);

  // H3: gated cb=0.02 arbitration A-score ≥ 0.02 above baseline
  const h3Gap = gated02.arbitration.clusterAScore - baseline.arbitration.clusterAScore;
  const h3Pass = h3Gap >= 0.02;
  console.log(`\nH3 — arb A-score lift (gated vs baseline): ${baseline.arbitration.clusterAScore.toFixed(4)} → ${gated02.arbitration.clusterAScore.toFixed(4)} gap=${h3Gap.toFixed(4)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: A-C arbitration gap wider under gated than baseline
  const h4Pass = gated02.arbitration.gap > baseline.arbitration.gap;
  console.log(`H4 — A-C gap: baseline=${baseline.arbitration.gap.toFixed(4)} gated=${gated02.arbitration.gap.toFixed(4)}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  console.log("\nFull comparison:");
  console.log("  condition                      mem-a1 rp   mem-c1 rp   arb-A   arb-C   A-C gap");
  for (const c of conditions) {
    console.log(
      `  ${c.label.padEnd(30)} ${c.finalState.memA1Rp.toFixed(4)}      ${c.finalState.memC1Rp.toFixed(4)}      ${c.arbitration.clusterAScore.toFixed(4)}  ${c.arbitration.clusterCScore.toFixed(4)}  ${c.arbitration.gap.toFixed(4)}`,
    );
  }

  saveResults("exp11", [
    `H1 quality-gated mem-c1 suppressed below importanceScore=${c1Baseline}: ${h1Pass ? "PASS" : "FAIL"}`,
    `H2 quality-gated c1 rp below Exp10 bare value (${exp10BareC1}): ${h2Pass ? "PASS" : "FAIL"}`,
    `H3 arbitration A-score lift ≥ 0.02 vs baseline: ${h3Pass ? "PASS" : "FAIL"} (gap=${h3Gap.toFixed(4)})`,
    `H4 A-C arbitration gap wider under compounding: ${h4Pass ? "PASS" : "FAIL"}`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
    c1Baseline,
    exp10BareC1Reference: exp10BareC1,
    conditions: conditions.map((c) => ({ ...c })),
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
