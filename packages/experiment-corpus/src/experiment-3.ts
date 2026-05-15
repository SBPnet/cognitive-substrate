/**
 * Experiment 3 — Session-Relative Novelty (Derived-T Model)
 *
 * Models exploration temperature as a session-local recency signal rather than
 * a global usage statistic. This is the cognitive substrate analogue of
 * ADHD-pattern attention: the pull toward a memory grows proportionally to how
 * long it has been absent from the retrieval window, independent of its
 * lifetime usage frequency.
 *
 * Scoring formula per turn:
 *
 *   recency(m, t)      = decay^(t - lastSeen(m))   where decay ∈ (0,1)
 *                        1.0  if retrieved last turn
 *                        0.0  if never retrieved this session
 *
 *   novelty(m, t)      = 1 - recency(m, t)
 *
 *   score(m, t)        = importance_score(m) + T × novelty(m, t)
 *
 * At T=0.1 (low):   novelty boost is weak; importance dominates; attention
 *                    stays anchored on cluster-A (task persistence).
 *
 * At T=0.5 (mid):   novelty boost is moderate; cluster-A memories that have
 *                    been retrieved recently lose ground; cluster-B members
 *                    start appearing in top-k mid-session.
 *
 * At T=0.9 (high):  novelty boost is strong; rank crossovers happen quickly;
 *                   cluster-B surfaces early and oscillates with cluster-A
 *                   as recency resets after each retrieval (hyperfocus pulse).
 *
 * Three sub-runs per T value test decay rate sensitivity:
 *   decay=0.9  slow fade — memories stay "recent" for many turns
 *   decay=0.5  medium    — recency halves every turn
 *   decay=0.1  fast fade — memories are "novel again" almost immediately
 *
 * InstrumentedPolicyEngine is used to emit OTel spans recording explorationFactor
 * at each turn so that the T trajectory is observable in traces.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp3
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
import type { Client } from "@opensearch-project/opensearch";
import { CORPUS_TURNS, CORPUS_MEMORIES } from "./corpus.js";
import type { CorpusMemoryId } from "./corpus.js";
import { saveResults } from "./results.js";

const TOP_K = 5;
const T_VALUES = [0.1, 0.5, 0.9] as const;
const DECAY_RATES = [0.9, 0.5, 0.1] as const;

// ---------------------------------------------------------------------------
// Session recency tracker
// ---------------------------------------------------------------------------

/**
 * Tracks when each memory was last retrieved within this session.
 * recency(m, t) = decay^(t - lastSeen(m)), clamped to [0, 1].
 * novelty(m, t) = 1 - recency(m, t).
 */
class RecencyTracker {
  private readonly lastSeenAt = new Map<string, number>();
  private turn = 0;

  constructor(private readonly decay: number) {}

  /** Call after each turn's retrieved IDs are known. */
  observe(retrievedIds: ReadonlyArray<string>): void {
    this.turn++;
    for (const id of retrievedIds) {
      this.lastSeenAt.set(id, this.turn);
    }
  }

  /** novelty(m) = 1 - recency(m) at the current turn. */
  novelty(memoryId: string): number {
    const lastSeen = this.lastSeenAt.get(memoryId);
    if (lastSeen === undefined) return 1.0; // never retrieved this session
    const age = this.turn - lastSeen;
    const recency = Math.pow(this.decay, age);
    return 1 - recency;
  }

  get currentTurn(): number {
    return this.turn;
  }
}

// ---------------------------------------------------------------------------
// Fetch all corpus memories from OpenSearch (static, fetched once)
// ---------------------------------------------------------------------------

interface SemanticDoc {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  usage_frequency: number;
  summary: string;
}

async function fetchAllMemories(client: Client): Promise<SemanticDoc[]> {
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
// Per-turn retrieval using session-relative novelty
// ---------------------------------------------------------------------------

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
  readonly topKScores: ReadonlyArray<{ memoryId: string; score: number; novelty: number }>;
}

// ---------------------------------------------------------------------------
// Single run (one T + one decay combination)
// ---------------------------------------------------------------------------

interface SubRunResult {
  readonly T: number;
  readonly decay: number;
  readonly hitRate: number;
  readonly breadth: number;
  readonly entropy: number;
  readonly uniqueMemoryIds: number;
  readonly clusterCoverage: number;
  readonly clusterCounts: Record<string, number>;
  readonly distribution: ReadonlyArray<{ memoryId: string; count: number }>;
  readonly firstCrossoverTurn: number | null;
  readonly turnResults: ReadonlyArray<TurnResult>;
}

async function runSubRun(
  client: Client,
  allMemories: SemanticDoc[],
  T: number,
  decay: number,
): Promise<SubRunResult> {
  const tracker = new RecencyTracker(decay);
  const frozenState = { ...createDefaultPolicyState(), explorationFactor: T };
  const store = new FrozenPolicyStore(frozenState);
  const engine = new InstrumentedPolicyEngine({ store });

  const breadthAcc = new RetrievalBreadthAccumulator();
  const turnResults: TurnResult[] = [];
  const clusterHits = new Map<string, number>();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];
  let firstCrossoverTurn: number | null = null;

  for (const turn of CORPUS_TURNS) {
    const ranked = scoreAndRank(allMemories, T, tracker, TOP_K);
    const retrievedIds = ranked.map((r) => r.memory_id);

    // Detect first turn where a cluster-B memory enters top-k
    if (firstCrossoverTurn === null && ranked.some((r) => r.semantic_cluster === "cluster-b")) {
      firstCrossoverTurn = tracker.currentTurn + 1; // +1 because observe() hasn't run yet
    }

    // Emit OTel span via InstrumentedPolicyEngine
    await engine.applyEvaluation({
      sourceExperienceId: turn.memoryId,
      rewardDelta: turn.signal.importance - 0.5,
    });

    tracker.observe(retrievedIds);

    const hitIds = turn.groundTruthTargets.filter((t) => retrievedIds.includes(t));
    const hit = hitIds.length > 0;

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
      hit,
      topKScores: ranked.map((r) => ({
        memoryId: r.memory_id,
        score: r.sessionScore,
        novelty: r.novelty,
      })),
    });
  }

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const breadthResult = breadthAcc.compute();
  const clustersReached = allClusters.filter((c) => (clusterHits.get(c) ?? 0) > 0).length;

  return {
    T,
    decay,
    hitRate,
    breadth: breadthResult.breadth,
    entropy: breadthResult.entropy,
    uniqueMemoryIds: breadthResult.uniqueMemoryIds,
    clusterCoverage: clustersReached / allClusters.length,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    distribution: breadthResult.distribution,
    firstCrossoverTurn,
    turnResults,
  };
}

// ---------------------------------------------------------------------------
// Print one sub-run detail
// ---------------------------------------------------------------------------

function printSubRun(result: SubRunResult): void {
  console.log(`\nT=${result.T}  decay=${result.decay}`);
  console.log(
    `${"Turn".padEnd(8)} ${"Memory".padEnd(10)} ${"Hit?".padEnd(5)} Top-${TOP_K} (id:score:novelty)`,
  );
  console.log("─".repeat(100));

  for (const r of result.turnResults) {
    const hitMark = r.hit ? "✓" : "✗";
    const topK = r.topKScores
      .map((s) => `${s.memoryId}:${s.score.toFixed(2)}:nov=${s.novelty.toFixed(2)}`)
      .join("  ");
    console.log(`${r.turnId.padEnd(8)} ${r.memoryId.padEnd(10)} ${hitMark.padEnd(5)} ${topK}`);
  }

  console.log(
    `  hitRate=${(result.hitRate * 100).toFixed(0)}%  breadth=${result.breadth.toFixed(3)}` +
      `  clusterB=${result.clusterCounts["cluster-b"] ?? 0}  crossover=turn-${result.firstCrossoverTurn ?? "never"}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`\nExperiment 3 — Session-Relative Novelty`);
  console.log(`OpenSearch: ${config.node}`);
  console.log(
    `Corpus: ${CORPUS_TURNS.length} turns, top-${TOP_K}, T×${T_VALUES.length} × decay×${DECAY_RATES.length} = ${T_VALUES.length * DECAY_RATES.length} sub-runs\n`,
  );

  const client = createOpenSearchClient(config);
  const allMemories = await fetchAllMemories(client);
  console.log(`Loaded ${allMemories.length} memories from memory_semantic`);
  console.log(
    `Corpus memories: ${CORPUS_MEMORIES.length} defined, ${allMemories.length} in index\n`,
  );

  const subRuns: SubRunResult[] = [];

  for (const T of T_VALUES) {
    for (const decay of DECAY_RATES) {
      console.log(`── T=${T}  decay=${decay} ────────────────────────────────`);
      const result = await runSubRun(client, allMemories, T, decay);
      subRuns.push(result);
      printSubRun(result);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------

  console.log("\n\n════════════════════════════════════════════════════════════════════════");
  console.log("Experiment 3 — Session-Relative Novelty Summary");
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log(
    `${"T".padEnd(5)} ${"decay".padEnd(7)} ${"hitRate".padEnd(10)} ${"breadth".padEnd(10)} ${"clusterB".padEnd(10)} ${"clusterCov".padEnd(12)} ${"crossover"}`,
  );
  console.log("─".repeat(70));

  for (const r of subRuns) {
    console.log(
      `${String(r.T).padEnd(5)} ${String(r.decay).padEnd(7)} ` +
        `${`${(r.hitRate * 100).toFixed(0)}%`.padEnd(10)} ` +
        `${r.breadth.toFixed(3).padEnd(10)} ` +
        `${String(r.clusterCounts["cluster-b"] ?? 0).padEnd(10)} ` +
        `${`${(r.clusterCoverage * 100).toFixed(0)}%`.padEnd(12)} ` +
        `turn-${r.firstCrossoverTurn ?? "never"}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Hypothesis checks
  // ---------------------------------------------------------------------------

  const highTRuns = subRuns.filter((r) => r.T === 0.9);
  const lowTRuns = subRuns.filter((r) => r.T === 0.1);

  const h1 = highTRuns.every((r) => (r.clusterCounts["cluster-b"] ?? 0) > 0);
  const h2 = lowTRuns.every(
    (r) => (r.clusterCounts["cluster-a"] ?? 0) > (r.clusterCounts["cluster-b"] ?? 0),
  );
  const h3 = highTRuns.every((r) => r.firstCrossoverTurn !== null);
  const h4Fast = subRuns
    .filter((r) => r.T === 0.9 && r.decay === 0.1)
    .every((r) => r.firstCrossoverTurn !== null && r.firstCrossoverTurn <= 5);
  const h4Slow = subRuns
    .filter((r) => r.T === 0.9 && r.decay === 0.9)
    .every((r) => r.firstCrossoverTurn === null || r.firstCrossoverTurn > 5);

  console.log(`
Hypothesis checks:
  H1: High-T surfaces cluster-B in every decay regime
      ${h1 ? "✓" : "✗"} cluster-B retrievals > 0 at T=0.9 for all decay rates
  H2: Low-T keeps cluster-A dominant over cluster-B
      ${h2 ? "✓" : "✗"} cluster-A > cluster-B at T=0.1 for all decay rates
  H3: Rank crossover occurs at high-T (cluster-B enters top-${TOP_K})
      ${h3 ? "✓" : "✗"} crossover observed in all T=0.9 runs
  H4a: Fast decay (0.1) causes early crossover at high-T (turn ≤ 5)
      ${h4Fast ? "✓" : "✗"} T=0.9 + decay=0.1 crossover turn: ${subRuns.find((r) => r.T === 0.9 && r.decay === 0.1)?.firstCrossoverTurn ?? "never"}
  H4b: Slow decay (0.9) delays crossover (turn > 5 or never)
      ${h4Slow ? "✓" : "✗"} T=0.9 + decay=0.9 crossover turn: ${subRuns.find((r) => r.T === 0.9 && r.decay === 0.9)?.firstCrossoverTurn ?? "never"}`);

  saveResults(
    "exp3",
    "Session-relative novelty model. score = importance + T*(1-recency). Crossover turn marks when cluster-B first enters top-k.",
    {
      topK: TOP_K,
      tValues: T_VALUES,
      decayRates: DECAY_RATES,
      hypotheses: { h1, h2, h3, h4Fast, h4Slow },
      subRuns: subRuns.map((r) => ({
        T: r.T,
        decay: r.decay,
        hitRate: r.hitRate,
        breadth: r.breadth,
        entropy: r.entropy,
        uniqueMemoryIds: r.uniqueMemoryIds,
        clusterCoverage: r.clusterCoverage,
        clusterCounts: r.clusterCounts,
        distribution: r.distribution,
        firstCrossoverTurn: r.firstCrossoverTurn,
        turns: r.turnResults,
      })),
    },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
