/**
 * Experiment 4 — Warm-Start Attentional Priming
 *
 * Tests whether pre-session retrieval history (attentional context) changes
 * what surfaces during a session, and whether T governs the rate at which
 * the system escapes or sustains that prior context.
 *
 * Motivation from Experiment 3:
 *   The cold-start ADHD run (T=0.9, decay=0.1) produced a deterministic
 *   alternating oscillator — AAAAB/BBCCA/AAAAB… — because all memories start
 *   with novelty=1.0 and the retrieval set is static. The hyperfocus run
 *   (T=0.9, decay=0.9) showed genuine emergent drift: B members gradually
 *   competed into positions 3-5 as session recency accumulated.
 *
 *   Exp 4 asks: does pre-seeding the recency tracker from a "prior session"
 *   materially change what surfaces, and does T control escape velocity from
 *   that prior context?
 *
 * Three start conditions, each run at T ∈ {0.1, 0.5, 0.9} × decay ∈ {0.9, 0.5}:
 *
 *   cold    — all memories start with novelty=1.0 (Exp 3 baseline)
 *
 *   primed-A — tracker pre-loaded as if cluster-A was retrieved every turn
 *              for 10 prior turns. Cluster-A has near-zero novelty at turn-1.
 *              Hypothesis: cluster-B surfaces earlier at high-T than cold-start;
 *              low-T stays on cluster-A regardless.
 *
 *   primed-B — tracker pre-loaded as if cluster-B was the recent focus
 *              for 10 prior turns. Cluster-B has near-zero novelty at turn-1.
 *              Hypothesis: cluster-A dominates turn-1 regardless of T;
 *              at high-T + fast-decay, cluster-B reclaims position by mid-session.
 *
 * Key metrics:
 *   firstClusterBTurn  — when cluster-B first enters top-k (escape from prior context)
 *   clusterAShare      — fraction of top-k slots taken by cluster-A across the run
 *   clusterBShare      — same for cluster-B
 *   hitRate            — ground-truth recall
 *   breadth            — Shannon entropy of retrieved IDs
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp4
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  FrozenPolicyStore,
  InstrumentedPolicyEngine,
  createDefaultPolicyState,
} from "@cognitive-substrate/policy-engine";
import { RetrievalBreadthAccumulator } from "@cognitive-substrate/retrieval-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES } from "./corpus.js";
import type { CorpusMemoryId } from "./corpus.js";
import { saveResults } from "./results.js";

const TOP_K = 5;
const T_VALUES = [0.1, 0.5, 0.9] as const;
const DECAY_RATES = [0.9, 0.5] as const;
const PRIOR_TURNS = 10; // simulated prior-session length

// ---------------------------------------------------------------------------
// Priming conditions
// ---------------------------------------------------------------------------

type PrimingCondition = "cold" | "primed-A" | "primed-B";

const CLUSTER_A_IDS = CORPUS_MEMORIES
  .filter((m) => m.semanticCluster === "cluster-a")
  .map((m) => m.memoryId);

const CLUSTER_B_IDS = CORPUS_MEMORIES
  .filter((m) => m.semanticCluster === "cluster-b")
  .map((m) => m.memoryId);

// ---------------------------------------------------------------------------
// Session recency tracker (same model as Exp 3)
// ---------------------------------------------------------------------------

class RecencyTracker {
  private readonly lastSeenAt = new Map<string, number>();
  private turn: number;

  constructor(private readonly decay: number, startTurn = 0) {
    this.turn = startTurn;
  }

  /** Pre-load prior session retrievals without advancing the "live" turn counter. */
  prime(memoryIds: ReadonlyArray<string>, atTurn: number): void {
    for (const id of memoryIds) {
      this.lastSeenAt.set(id, atTurn);
    }
  }

  observe(retrievedIds: ReadonlyArray<string>): void {
    this.turn++;
    for (const id of retrievedIds) {
      this.lastSeenAt.set(id, this.turn);
    }
  }

  novelty(memoryId: string): number {
    const lastSeen = this.lastSeenAt.get(memoryId);
    if (lastSeen === undefined) return 1.0;
    const age = this.turn - lastSeen;
    return 1 - Math.pow(this.decay, age);
  }

  get currentTurn(): number { return this.turn; }
}

// ---------------------------------------------------------------------------
// Memory docs (fetched once from OS, scored in-process)
// ---------------------------------------------------------------------------

interface SemanticDoc {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  usage_frequency: number;
  summary: string;
}

function scoreAndRank(
  memories: SemanticDoc[],
  T: number,
  tracker: RecencyTracker,
  k: number,
): Array<SemanticDoc & { sessionScore: number; novelty: number }> {
  return memories
    .map((m) => {
      const nov = tracker.novelty(m.memory_id);
      return { ...m, novelty: nov, sessionScore: m.importance_score + T * nov };
    })
    .sort((a, b) => b.sessionScore - a.sessionScore)
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Per-turn result
// ---------------------------------------------------------------------------

interface TurnResult {
  readonly turnId: string;
  readonly memoryId: CorpusMemoryId;
  readonly groundTruthTargets: ReadonlyArray<CorpusMemoryId>;
  readonly retrievedIds: ReadonlyArray<string>;
  readonly hitIds: ReadonlyArray<string>;
  readonly hit: boolean;
  readonly clusterSlots: string; // e.g. "AAABB"
  readonly topKScores: ReadonlyArray<{ memoryId: string; score: number; novelty: number }>;
}

// ---------------------------------------------------------------------------
// Sub-run result
// ---------------------------------------------------------------------------

interface SubRunResult {
  readonly condition: PrimingCondition;
  readonly T: number;
  readonly decay: number;
  readonly hitRate: number;
  readonly breadth: number;
  readonly clusterAShare: number;
  readonly clusterBShare: number;
  readonly clusterCounts: Record<string, number>;
  readonly firstClusterBTurn: number | null;
  readonly turnResults: ReadonlyArray<TurnResult>;
}

// ---------------------------------------------------------------------------
// Build a primed tracker
// ---------------------------------------------------------------------------

function buildTracker(condition: PrimingCondition, decay: number): RecencyTracker {
  // Prior-session turns are at negative offsets so live turn-1 is at offset 1.
  // Turn 0 = last prior turn; turn -PRIOR_TURNS+1 = first prior turn.
  const tracker = new RecencyTracker(decay, 0);

  if (condition === "cold") {
    // No priming — all memories start with novelty=1.0
    return tracker;
  }

  const primeIds = condition === "primed-A" ? CLUSTER_A_IDS : CLUSTER_B_IDS;

  // Simulate PRIOR_TURNS of retrievals ending at turn 0.
  // Each prior turn retrieves all primeIds (round-robin through them).
  for (let t = -PRIOR_TURNS + 1; t <= 0; t++) {
    for (const id of primeIds) {
      tracker.prime([id], t);
    }
  }

  return tracker;
}

// ---------------------------------------------------------------------------
// Run one condition × T × decay combination
// ---------------------------------------------------------------------------

async function runSubRun(
  allMemories: SemanticDoc[],
  condition: PrimingCondition,
  T: number,
  decay: number,
): Promise<SubRunResult> {
  const tracker = buildTracker(condition, decay);
  const frozenState = { ...createDefaultPolicyState(), explorationFactor: T };
  const store = new FrozenPolicyStore(frozenState);
  const engine = new InstrumentedPolicyEngine({ store });

  const breadthAcc = new RetrievalBreadthAccumulator();
  const turnResults: TurnResult[] = [];
  const clusterHits = new Map<string, number>();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];
  let firstClusterBTurn: number | null = null;

  for (const turn of CORPUS_TURNS) {
    const ranked = scoreAndRank(allMemories, T, tracker, TOP_K);
    const retrievedIds = ranked.map((r) => r.memory_id);

    const clusterSlots = ranked
      .map((r) => r.semantic_cluster.replace("cluster-", "").toUpperCase())
      .join("");

    if (firstClusterBTurn === null && ranked.some((r) => r.semantic_cluster === "cluster-b")) {
      firstClusterBTurn = tracker.currentTurn + 1;
    }

    await engine.applyEvaluation({
      sourceExperienceId: turn.memoryId,
      rewardDelta: turn.signal.importance - 0.5,
    });

    tracker.observe(retrievedIds);

    const hitIds = turn.groundTruthTargets.filter((t) => retrievedIds.includes(t));

    breadthAcc.observe({
      memories: retrievedIds.map((id) => ({
        memoryId: id,
        index: "memory_semantic" as const,
        score: 0,
        summary: "",
        importanceScore: 0,
        lastRetrieved: "",
      })),
      queryEmbedding: [],
    });

    for (const r of ranked) {
      clusterHits.set(r.semantic_cluster, (clusterHits.get(r.semantic_cluster) ?? 0) + 1);
    }

    turnResults.push({
      turnId: turn.turnId,
      memoryId: turn.memoryId,
      groundTruthTargets: turn.groundTruthTargets,
      retrievedIds,
      hitIds,
      hit: hitIds.length > 0,
      clusterSlots,
      topKScores: ranked.map((r) => ({
        memoryId: r.memory_id,
        score: r.sessionScore,
        novelty: r.novelty,
      })),
    });
  }

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const breadthResult = breadthAcc.compute();
  const totalSlots = CORPUS_TURNS.length * TOP_K;

  return {
    condition,
    T,
    decay,
    hitRate,
    breadth: breadthResult.breadth,
    clusterAShare: (clusterHits.get("cluster-a") ?? 0) / totalSlots,
    clusterBShare: (clusterHits.get("cluster-b") ?? 0) / totalSlots,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    firstClusterBTurn,
    turnResults,
  };
}

// ---------------------------------------------------------------------------
// Fetch all memories
// ---------------------------------------------------------------------------

async function fetchAllMemories(client: ReturnType<typeof createOpenSearchClient>): Promise<SemanticDoc[]> {
  const response = await client.search({
    index: "memory_semantic",
    body: {
      size: 50,
      query: { match_all: {} },
      _source: ["memory_id", "semantic_cluster", "importance_score", "usage_frequency", "summary"],
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response.body as any).hits.hits.map((h: any) => h._source as SemanticDoc);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  const conditions: PrimingCondition[] = ["cold", "primed-A", "primed-B"];
  const totalRuns = conditions.length * T_VALUES.length * DECAY_RATES.length;

  console.log(`\nExperiment 4 — Warm-Start Attentional Priming`);
  console.log(`OpenSearch: ${config.node}`);
  console.log(`Corpus: ${CORPUS_TURNS.length} turns, top-${TOP_K}`);
  console.log(`Conditions: ${conditions.join(", ")}`);
  console.log(`T × decay: ${T_VALUES.length} × ${DECAY_RATES.length} = ${T_VALUES.length * DECAY_RATES.length} per condition`);
  console.log(`Total sub-runs: ${totalRuns}\n`);
  console.log(`Prior session: ${PRIOR_TURNS} turns priming the designated cluster\n`);

  const client = createOpenSearchClient(config);
  const allMemories = await fetchAllMemories(client);
  console.log(`Loaded ${allMemories.length} memories\n`);

  // Show novelty at turn-1 for each condition to verify priming worked
  console.log("Novelty at session start (turn 0, before any live retrieval):");
  for (const condition of conditions) {
    const t = buildTracker(condition, 0.5);
    const novelties = allMemories.map((m) => `${m.memory_id}=${t.novelty(m.memory_id).toFixed(2)}`);
    console.log(`  ${condition.padEnd(10)}: ${novelties.join("  ")}`);
  }
  console.log();

  const subRuns: SubRunResult[] = [];

  for (const condition of conditions) {
    for (const T of T_VALUES) {
      for (const decay of DECAY_RATES) {
        const result = await runSubRun(allMemories, condition, T, decay);
        subRuns.push(result);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-condition × T summary (collapsed across decay)
  // ---------------------------------------------------------------------------

  console.log("\n════════════════════════════════════════════════════════════════════════════");
  console.log("Experiment 4 — Attentional Priming Results");
  console.log("════════════════════════════════════════════════════════════════════════════");
  console.log(
    `${"condition".padEnd(12)} ${"T".padEnd(5)} ${"decay".padEnd(7)} ` +
    `${"hitRate".padEnd(9)} ${"A-share".padEnd(9)} ${"B-share".padEnd(9)} ` +
    `${"breadth".padEnd(9)} ${"firstB"}`,
  );
  console.log("─".repeat(80));

  for (const r of subRuns) {
    console.log(
      `${r.condition.padEnd(12)} ${String(r.T).padEnd(5)} ${String(r.decay).padEnd(7)} ` +
      `${`${(r.hitRate * 100).toFixed(0)}%`.padEnd(9)} ` +
      `${(r.clusterAShare * 100).toFixed(0).padEnd(8)}% ` +
      `${(r.clusterBShare * 100).toFixed(0).padEnd(8)}% ` +
      `${r.breadth.toFixed(3).padEnd(9)} ` +
      `turn-${r.firstClusterBTurn ?? "never"}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Turn-by-turn cluster pattern for key contrasts
  // ---------------------------------------------------------------------------

  const keyContrasts: Array<{ condition: PrimingCondition; T: number; decay: number }> = [
    { condition: "cold",     T: 0.9, decay: 0.9 },
    { condition: "primed-A", T: 0.9, decay: 0.9 },
    { condition: "primed-B", T: 0.9, decay: 0.9 },
    { condition: "primed-A", T: 0.1, decay: 0.9 },
    { condition: "primed-B", T: 0.5, decay: 0.5 },
  ];

  console.log("\nKey contrasts — per-turn cluster slot pattern (A/B/C):");
  for (const key of keyContrasts) {
    const run = subRuns.find(
      (r) => r.condition === key.condition && r.T === key.T && r.decay === key.decay,
    );
    if (!run) continue;
    const pattern = run.turnResults.map((t) => t.clusterSlots).join(" ");
    console.log(`  ${key.condition.padEnd(10)} T=${key.T} decay=${key.decay}: ${pattern}`);
    console.log(
      `    hitRate=${(run.hitRate * 100).toFixed(0)}%  A=${(run.clusterAShare * 100).toFixed(0)}%  ` +
      `B=${(run.clusterBShare * 100).toFixed(0)}%  firstB=turn-${run.firstClusterBTurn ?? "never"}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Hypothesis checks
  // ---------------------------------------------------------------------------

  // H1: primed-A suppresses cluster-B appearance vs cold at low-T
  const primALowT = subRuns.filter((r) => r.condition === "primed-A" && r.T === 0.1);
  const coldLowT = subRuns.filter((r) => r.condition === "cold" && r.T === 0.1);
  const h1 = primALowT.every((pa) => {
    const cold = coldLowT.find((c) => c.decay === pa.decay);
    return pa.clusterBShare <= (cold?.clusterBShare ?? 1);
  });

  // H2: primed-A delays cluster-B appearance vs cold at high-T
  const primAHighT = subRuns.filter((r) => r.condition === "primed-A" && r.T === 0.9);
  const coldHighT = subRuns.filter((r) => r.condition === "cold" && r.T === 0.9);
  const h2 = primAHighT.every((pa) => {
    const cold = coldHighT.find((c) => c.decay === pa.decay);
    return (pa.firstClusterBTurn ?? Infinity) >= (cold?.firstClusterBTurn ?? Infinity);
  });

  // H3: primed-B causes cluster-A to dominate turn-1 (B is stale, so A is novel)
  const primBTurn1 = subRuns.filter((r) => r.condition === "primed-B");
  const h3 = primBTurn1.every((r) => r.turnResults[0]?.clusterSlots.startsWith("A"));

  // H4: at high-T + fast-decay, primed-B reclaims cluster-B by mid-session
  const primBHighTFast = subRuns.filter(
    (r) => r.condition === "primed-B" && r.T === 0.9 && r.decay === 0.5,
  );
  const h4 = primBHighTFast.every((r) => {
    const midTurns = r.turnResults.slice(9); // turns 11–20
    return midTurns.some((t) => t.clusterSlots.includes("B"));
  });

  console.log(`
Hypothesis checks:
  H1: primed-A suppresses cluster-B at low-T vs cold
      ${h1 ? "✓" : "✗"} B-share: primed-A=${primALowT.map((r) => `${(r.clusterBShare * 100).toFixed(0)}%`).join("/")}  cold=${coldLowT.map((r) => `${(r.clusterBShare * 100).toFixed(0)}%`).join("/")}

  H2: primed-A delays cluster-B crossover at high-T vs cold
      ${h2 ? "✓" : "✗"} firstB: primed-A=${primAHighT.map((r) => `turn-${r.firstClusterBTurn ?? "never"}`).join("/")}  cold=${coldHighT.map((r) => `turn-${r.firstClusterBTurn ?? "never"}`).join("/")}

  H3: primed-B makes cluster-A dominate turn-1 (B is stale)
      ${h3 ? "✓" : "✗"} turn-1 patterns: ${primBTurn1.map((r) => `${r.T}/${r.decay}=${r.turnResults[0]?.clusterSlots}`).join("  ")}

  H4: primed-B cluster-B reclaims top-k by mid-session at high-T + fast decay
      ${h4 ? "✓" : "✗"} T=0.9 decay=0.5: mid-session B appearances = ${primBHighTFast.map((r) => r.turnResults.slice(9).filter((t) => t.clusterSlots.includes("B")).length).join(",")}/10 turns`);

  saveResults(
    "exp4",
    "Warm-start priming. Prior-session retrieval history shapes what surfaces at session open. T governs escape velocity from prior context.",
    {
      topK: TOP_K,
      tValues: T_VALUES,
      decayRates: DECAY_RATES,
      priorTurns: PRIOR_TURNS,
      conditions,
      hypotheses: { h1, h2, h3, h4 },
      subRuns: subRuns.map((r) => ({
        condition: r.condition,
        T: r.T,
        decay: r.decay,
        hitRate: r.hitRate,
        breadth: r.breadth,
        clusterAShare: r.clusterAShare,
        clusterBShare: r.clusterBShare,
        clusterCounts: r.clusterCounts,
        firstClusterBTurn: r.firstClusterBTurn,
        clusterPattern: r.turnResults.map((t) => t.clusterSlots).join(" "),
        turns: r.turnResults,
      })),
    },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
