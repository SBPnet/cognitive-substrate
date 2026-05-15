/**
 * Experiment 14 — Multi-Agent Arbitration
 *
 * Experiments 1–13 validated the signal chain from reinforcement through
 * policy drift and temporal decay. This experiment closes the loop at the
 * top of the stack: does the arbitration layer correctly select the proposal
 * supported by better-grounded memories when two agents compete?
 *
 * Design:
 *   Two agents propose competing actions. Agent-A grounds its proposal in
 *   cluster-A memories (high rp, low risk). Agent-C grounds its proposal in
 *   cluster-C memories (low rp, high risk). After establishing a reinforced
 *   rp landscape (cb=0.02, 100 turns), the experiment:
 *
 *   1. Scores each agent's proposal against the current corpus state.
 *   2. Calls `arbitrate([agentA, agentC])` and verifies agent-A wins.
 *   3. Runs a "degraded" scenario where agent-A retrieves fewer memories
 *      (low memoryAlignment) vs agent-C with a full set — verifies that
 *      raw memory count can be outweighed by rp-derived confidence.
 *   4. Tests the "tie-break" scenario: both agents retrieve 3 memories, but
 *      agent-A's memories have higher rp → higher confidence → agent-A wins
 *      on confidence alone.
 *
 * Hypotheses:
 *   H1: With full memory support (3 vs 2), agent-A beats agent-C in
 *       arbitration after reinforcement-derived rp differentiation.
 *   H2: Agent-A wins even when agent-C has *more* retrieved memories (3 vs 5)
 *       if confidence is proportional to avg rp of retrieved memories.
 *   H3: In an equal-memory-count scenario (3 vs 3), agent-A still wins because
 *       rp-derived confidence (0.81 vs 0.26) outweighs the risk penalty.
 *   H4: Agent-A wins in all four scenarios — the combination of higher
 *       confidence (rp-derived) and lower risk is robust across memory-count
 *       asymmetries and the presence/absence of Hebbian compounding.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp14
 */

import {
  createOpenSearchClient,
  getDocument,
  updateDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { scoreDebateCandidate, arbitrate } from "@cognitive-substrate/agents";
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

interface ScenarioResult {
  label: string;
  agentAScore: number;
  agentCScore: number;
  margin: number;
  winner: string;
  agentAConfidence: number;
  agentCConfidence: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jitter(v: number): number {
  return Math.max(0, Math.min(1, v + (Math.random() - 0.5) * 2 * JITTER));
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
    ...(signal.toolUsefulness !== undefined
      ? { toolUsefulness: jitter(signal.toolUsefulness) }
      : {}),
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

async function avgRp(
  client: ReturnType<typeof createOpenSearchClient>,
  ids: string[],
): Promise<number> {
  const docs = await Promise.all(ids.map((id) => getDocument<SemanticDoc>(client, INDEX, id)));
  return docs.reduce((sum, d) => sum + (d?.retrieval_priority ?? 0), 0) / ids.length;
}

function makeAgentResult(
  id: string,
  confidence: number,
  riskScore: number,
  memoryIds: string[],
): AgentResult {
  return {
    agentId: id,
    agentType: "planner",
    traceId: "exp14",
    timestamp: new Date().toISOString(),
    proposal: `Action proposed by ${id} based on retrieved memories.`,
    reasoning: `Supported by ${memoryIds.length} memories with avg rp=${confidence.toFixed(3)}.`,
    confidence: Math.min(1, confidence),
    riskScore,
    retrievedMemories: memoryIds,
  };
}

async function runScenario(
  client: ReturnType<typeof createOpenSearchClient>,
  label: string,
  agentAMemIds: string[],
  agentCMemIds: string[],
): Promise<ScenarioResult> {
  const [aConf, cConf] = await Promise.all([
    avgRp(client, agentAMemIds),
    avgRp(client, agentCMemIds),
  ]);

  // risk: cluster-A = 0.1 (trusted), cluster-C = 0.6 (contradictory)
  const agentA = makeAgentResult("agent-A", aConf, 0.1, agentAMemIds);
  const agentC = makeAgentResult("agent-C", cConf, 0.6, agentCMemIds);

  const aScore = scoreDebateCandidate(agentA).total;
  const cScore = scoreDebateCandidate(agentC).total;
  const decision = arbitrate([agentA, agentC]);

  console.log(
    `  ${label}: agent-A ${aScore.toFixed(4)} (conf=${aConf.toFixed(4)}, mems=${agentAMemIds.length}) vs agent-C ${cScore.toFixed(4)} (conf=${cConf.toFixed(4)}, mems=${agentCMemIds.length}) → winner=${decision.winnerId} margin=${(aScore - cScore).toFixed(4)}`,
  );

  return {
    label,
    agentAScore: aScore,
    agentCScore: cScore,
    margin: aScore - cScore,
    winner: decision.winnerId,
    agentAConfidence: aConf,
    agentCConfidence: cConf,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 14: Multi-Agent Arbitration ===\n");

  // Phase 1: establish reinforced rp landscape
  console.log("Phase 1: 100 reinforcement turns (cb=0.02)...");
  await resetAll(client);
  const engine = new ReinforcementEngine({ openSearch: client, countBonus: 0.02 });
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of CORPUS_TURNS) {
      await engine.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });
    }
  }

  // Baseline rp snapshot for reporting
  const [aAvg, bAvg, cAvg] = await Promise.all([
    avgRp(client, ["mem-a1", "mem-a2", "mem-a3"]),
    avgRp(client, ["mem-b1", "mem-b2", "mem-b3"]),
    avgRp(client, ["mem-c1", "mem-c2"]),
  ]);
  console.log(`\nPost-reinforcement cluster avgs: A=${aAvg.toFixed(4)} B=${bAvg.toFixed(4)} C=${cAvg.toFixed(4)}`);

  console.log("\nPhase 2: arbitration scenarios...");

  // Scenario 1: Full memory support — agent-A (3) vs agent-C (2)
  const s1 = await runScenario(
    client,
    "full support (A=3, C=2)",
    ["mem-a1", "mem-a2", "mem-a3"],
    ["mem-c1", "mem-c2"],
  );

  // Scenario 2: Degraded A — agent-A (2) vs agent-C (5 memories incl. cluster-B mix)
  const s2 = await runScenario(
    client,
    "degraded A (A=2, C=5 with B-mix)",
    ["mem-a1", "mem-a2"],
    ["mem-c1", "mem-c2", "mem-b1", "mem-b2", "mem-b3"],
  );

  // Scenario 3: Equal memory count — agent-A (3) vs agent-C (3 incl. B-mix)
  const s3 = await runScenario(
    client,
    "equal count (A=3, C=3)",
    ["mem-a1", "mem-a2", "mem-a3"],
    ["mem-c1", "mem-c2", "mem-b1"],
  );

  // Scenario 4: Baseline (unreinforced rp = importanceScore) for comparison
  await resetAll(client);
  const s4 = await runScenario(
    client,
    "baseline (no reinforcement, A=3, C=2)",
    ["mem-a1", "mem-a2", "mem-a3"],
    ["mem-c1", "mem-c2"],
  );

  await resetAll(client);
  console.log("\nRestored baseline state.");

  const h1Pass = s1.winner === "agent-A";
  console.log(`\nH1 — agent-A wins with full support (A=3, C=2): ${h1Pass ? "✓ PASS" : "✗ FAIL"} (winner=${s1.winner})`);

  const h2Pass = s2.winner === "agent-A";
  console.log(`H2 — agent-A wins even when agent-C has more memories (A=2, C=5): ${h2Pass ? "✓ PASS" : "✗ FAIL"} (winner=${s2.winner})`);

  const h3Pass = s3.winner === "agent-A";
  console.log(`H3 — agent-A wins with equal memory count (A=3, C=3): ${h3Pass ? "✓ PASS" : "✗ FAIL"} (winner=${s3.winner})`);

  // H4: agent-A wins all four scenarios — confidence + risk robustly beats count advantage
  const h4Pass = [s1, s2, s3, s4].every((s) => s.winner === "agent-A");
  console.log(
    `H4 — agent-A wins all 4 scenarios: ${h4Pass ? "✓ PASS" : "✗ FAIL"} (s1=${s1.winner}, s2=${s2.winner}, s3=${s3.winner}, s4=${s4.winner})`,
  );

  saveResults(
    "exp14",
    [
      `H1 agent-A wins with full support: ${h1Pass ? "PASS" : "FAIL"} (A=${s1.agentAScore.toFixed(4)}, C=${s1.agentCScore.toFixed(4)}, margin=${s1.margin.toFixed(4)})`,
      `H2 agent-A wins despite fewer memories (A=2 vs C=5): ${h2Pass ? "PASS" : "FAIL"} (A=${s2.agentAScore.toFixed(4)}, C=${s2.agentCScore.toFixed(4)})`,
      `H3 agent-A wins with equal memory count (3 vs 3): ${h3Pass ? "PASS" : "FAIL"} (A=${s3.agentAScore.toFixed(4)}, C=${s3.agentCScore.toFixed(4)})`,
      `H4 agent-A wins all 4 scenarios (conf+risk beats count): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      clusterAvgs: { a: aAvg, b: bAvg, c: cAvg },
      scenarios: [s1, s2, s3, s4],
    },
  );

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
