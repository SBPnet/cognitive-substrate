/**
 * Experiment 6 — Graph Diversity Slot + AttentionEngine Integration Validation
 *
 * Two things tested together:
 *
 * PART A — Graph diversity slot
 *   In Experiment 5, graph expansion never recovered mem-b3 because the
 *   graph-derived score lost to direct session scores. Here we reserve one
 *   slot in top-k specifically for the highest-scoring graph neighbour not
 *   already in the result set, bypassing score competition entirely.
 *
 *   Strategies compared (session-relative novelty, decay=0.5, T ∈ {0.1,0.5,0.9}):
 *     flat         — no graph (Exp 3/5 baseline)
 *     graph-scored — Exp 5 expansion (seed × strength × Tg, Tg=0.3)
 *     graph-slot   — flat top-(k-1) + 1 guaranteed graph-neighbour slot
 *
 * PART B — AttentionEngine integration validation
 *   Verifies that explorationFactor from PolicyState actually shifts salience
 *   rankings in the production AttentionEngine.scoreSalience formula.
 *   This closes the loop between harness experiments and real production code.
 *
 *   For each T value, corpus memories are shaped into AttentionCandidates and
 *   routed through AttentionEngine.route with policy.explorationFactor = T.
 *   We measure:
 *     - rank of cluster-B memories at T=0.1 vs T=0.9
 *     - whether novelty-weight scaling changes primary vs background assignment
 *     - whether the attention engine agrees with the harness score ranking
 *
 * Key metrics (Part A):
 *   mem-b3 hit rate  — primary target; isolated node with no inbound links
 *   overall hit rate — ground-truth recall
 *   graph slot used  — fraction of turns the diversity slot added a new memory
 *   c1 surface rate  — cost: contradicts link still reachable via graph slot
 *
 * Key metrics (Part B):
 *   b-cluster primary rate  — fraction of cluster-B members landing in primary lane
 *   rank shift              — rank change for cluster-B at T=0.9 vs T=0.1
 *   harness/engine agreement — whether top-k ordering matches between models
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp6
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  AttentionEngine,
  scoreSalience,
} from "@cognitive-substrate/attention-engine";
import type { AttentionCandidate, AttentionContext } from "@cognitive-substrate/attention-engine";
import {
  FrozenPolicyStore,
  createDefaultPolicyState,
} from "@cognitive-substrate/policy-engine";
import { RetrievalBreadthAccumulator } from "@cognitive-substrate/retrieval-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES } from "./corpus.js";
import type { CorpusMemoryId } from "./corpus.js";
import { saveResults } from "./results.js";

const TOP_K = 5;
const DECAY = 0.5;
const T_GRAPH = 0.3;
const T_VALUES = [0.1, 0.5, 0.9] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  usage_frequency: number;
  summary: string;
}

interface LinkDoc {
  link_id: string;
  source_memory_id: string;
  target_memory_id: string;
  relationship_type: string;
  strength: number;
}

interface ScoredMemory extends SemanticDoc {
  sessionScore: number;
  novelty: number;
  via: "direct" | string;
}

// ---------------------------------------------------------------------------
// Recency tracker
// ---------------------------------------------------------------------------

class RecencyTracker {
  private readonly lastSeenAt = new Map<string, number>();
  private turn = 0;

  constructor(private readonly decay: number) {}

  observe(ids: ReadonlyArray<string>): void {
    this.turn++;
    for (const id of ids) this.lastSeenAt.set(id, this.turn);
  }

  novelty(id: string): number {
    const last = this.lastSeenAt.get(id);
    if (last === undefined) return 1.0;
    return 1 - Math.pow(this.decay, this.turn - last);
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function sessionScore(m: SemanticDoc, T: number, tracker: RecencyTracker): ScoredMemory {
  const nov = tracker.novelty(m.memory_id);
  return { ...m, novelty: nov, sessionScore: m.importance_score + T * nov, via: "direct" };
}

function graphNeighbours(
  seeds: ScoredMemory[],
  allMemories: SemanticDoc[],
  links: LinkDoc[],
  T: number,
  tracker: RecencyTracker,
): ScoredMemory[] {
  const byId = new Map(allMemories.map((m) => [m.memory_id, m]));
  const seedIds = new Set(seeds.map((s) => s.memory_id));
  const neighbours: ScoredMemory[] = [];

  for (const seed of seeds) {
    for (const link of links) {
      const neighbourId =
        link.source_memory_id === seed.memory_id ? link.target_memory_id
        : link.target_memory_id === seed.memory_id ? link.source_memory_id
        : null;
      if (!neighbourId || seedIds.has(neighbourId)) continue;

      const neighbour = byId.get(neighbourId);
      if (!neighbour) continue;

      const nov = tracker.novelty(neighbourId);
      const score = seed.sessionScore * link.strength * T_GRAPH + T * nov;
      neighbours.push({
        ...neighbour,
        novelty: nov,
        sessionScore: score,
        via: `graph:${link.link_id}:${link.relationship_type}`,
      });
    }
  }

  // De-duplicate: keep best score per neighbour ID
  const best = new Map<string, ScoredMemory>();
  for (const n of neighbours) {
    const prev = best.get(n.memory_id);
    if (!prev || n.sessionScore > prev.sessionScore) best.set(n.memory_id, n);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Part A — retrieval strategies
// ---------------------------------------------------------------------------

type Strategy = "flat" | "graph-scored" | "graph-slot";

interface TurnResult {
  readonly turnId: string;
  readonly memoryId: CorpusMemoryId;
  readonly groundTruthTargets: ReadonlyArray<CorpusMemoryId>;
  readonly retrievedIds: ReadonlyArray<string>;
  readonly hitIds: ReadonlyArray<string>;
  readonly hit: boolean;
  readonly hitB3: boolean;
  readonly surfacedC1: boolean;
  readonly clusterSlots: string;
  readonly graphSlotUsed: boolean;
  readonly graphSlotId: string | null;
}

interface PartAResult {
  readonly strategy: Strategy;
  readonly T: number;
  readonly hitRate: number;
  readonly b3HitRate: number;
  readonly c1SurfaceRate: number;
  readonly graphSlotUsedRate: number;
  readonly breadth: number;
  readonly clusterCounts: Record<string, number>;
  readonly turnResults: ReadonlyArray<TurnResult>;
}

function runPartA(
  allMemories: SemanticDoc[],
  links: LinkDoc[],
  strategy: Strategy,
  T: number,
): PartAResult {
  const tracker = new RecencyTracker(DECAY);
  const breadthAcc = new RetrievalBreadthAccumulator();
  const clusterHits = new Map<string, number>();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];
  const turnResults: TurnResult[] = [];

  const b3TargetTurns = new Set(
    CORPUS_TURNS.filter((t) => t.groundTruthTargets.includes("mem-b3")).map((t) => t.turnId),
  );

  for (const turn of CORPUS_TURNS) {
    const scored = allMemories.map((m) => sessionScore(m, T, tracker));
    const sortedDirect = [...scored].sort((a, b) => b.sessionScore - a.sessionScore);

    let topK: ScoredMemory[];
    let graphSlotUsed = false;
    let graphSlotId: string | null = null;

    if (strategy === "flat") {
      topK = sortedDirect.slice(0, TOP_K);
    } else if (strategy === "graph-scored") {
      const seeds = sortedDirect.slice(0, TOP_K);
      const neighbours = graphNeighbours(seeds, allMemories, links, T, tracker);
      const merged = [...seeds, ...neighbours].sort((a, b) => b.sessionScore - a.sessionScore);
      const seen = new Set<string>();
      topK = merged.filter((m) => { if (seen.has(m.memory_id)) return false; seen.add(m.memory_id); return true; }).slice(0, TOP_K);
    } else {
      // graph-slot: flat top-(k-1), then reserve position k for best new graph neighbour
      const baseK = TOP_K - 1;
      const baseSlots = sortedDirect.slice(0, baseK);
      const neighbours = graphNeighbours(baseSlots, allMemories, links, T, tracker);
      const baseIds = new Set(baseSlots.map((m) => m.memory_id));
      const newNeighbours = neighbours
        .filter((n) => !baseIds.has(n.memory_id))
        .sort((a, b) => b.sessionScore - a.sessionScore);

      if (newNeighbours.length > 0) {
        graphSlotUsed = true;
        graphSlotId = newNeighbours[0]!.memory_id;
        topK = [...baseSlots, newNeighbours[0]!];
      } else {
        // No new neighbours — fall back to k-th flat result
        topK = sortedDirect.slice(0, TOP_K);
      }
    }

    const retrievedIds = topK.map((m) => m.memory_id);
    const clusterSlots = topK.map((m) => m.semantic_cluster.replace("cluster-", "").toUpperCase()).join("");

    tracker.observe(retrievedIds);

    const hitIds = turn.groundTruthTargets.filter((t) => retrievedIds.includes(t));

    breadthAcc.observe({
      memories: retrievedIds.map((id) => ({
        memoryId: id, index: "memory_semantic" as const,
        score: 0, summary: "", importanceScore: 0, lastRetrieved: "",
      })),
      queryEmbedding: [],
    });

    for (const m of topK) {
      clusterHits.set(m.semantic_cluster, (clusterHits.get(m.semantic_cluster) ?? 0) + 1);
    }

    turnResults.push({
      turnId: turn.turnId,
      memoryId: turn.memoryId,
      groundTruthTargets: turn.groundTruthTargets,
      retrievedIds,
      hitIds,
      hit: hitIds.length > 0,
      hitB3: retrievedIds.includes("mem-b3"),
      surfacedC1: retrievedIds.includes("mem-c1"),
      clusterSlots,
      graphSlotUsed,
      graphSlotId,
    });
  }

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const b3Turns = turnResults.filter((r) => b3TargetTurns.has(r.turnId));
  const b3HitRate = b3Turns.filter((r) => r.hitB3).length / Math.max(b3Turns.length, 1);
  const c1SurfaceRate = turnResults.filter((r) => r.surfacedC1).length / turnResults.length;
  const graphSlotUsedRate = turnResults.filter((r) => r.graphSlotUsed).length / turnResults.length;
  const breadthResult = breadthAcc.compute();

  return {
    strategy,
    T,
    hitRate,
    b3HitRate,
    c1SurfaceRate,
    graphSlotUsedRate,
    breadth: breadthResult.breadth,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    turnResults,
  };
}

// ---------------------------------------------------------------------------
// Part B — AttentionEngine integration
// ---------------------------------------------------------------------------

interface AttentionRunResult {
  readonly T: number;
  readonly rankings: ReadonlyArray<{ memoryId: string; cluster: string; salience: number; rank: number; lane: string }>;
  readonly clusterBPrimaryCount: number;
  readonly clusterBAvgRank: number;
  readonly clusterBAvgSalience: number;
  readonly primaryIds: ReadonlyArray<string>;
  readonly harnessTop5: ReadonlyArray<string>;
  readonly harnessEngineAgreement: number; // fraction of top-5 slots that agree
}

function runPartB(allMemories: SemanticDoc[], T: number): AttentionRunResult {
  const engine = new AttentionEngine();
  const frozenState = { ...createDefaultPolicyState(), explorationFactor: T };
  const policy = frozenState;

  // Shape corpus memories into AttentionCandidates.
  // novelty maps to the memory's intrinsic novelty signal (1 - usage_frequency),
  // which is exactly what explorationFactor should modulate in production.
  const candidates: AttentionCandidate[] = allMemories.map((m) => ({
    candidateId: m.memory_id,
    summary: m.summary,
    source: "memory" as const,
    importance: m.importance_score,
    novelty: 1 - m.usage_frequency,   // low usage = high novelty
    relevance: m.importance_score,     // stand-in for query relevance
    urgency: 0.3,                      // neutral urgency (no active goal in corpus)
    risk: m.semantic_cluster === "cluster-c" ? 0.6 : 0.1,
  }));

  const context: AttentionContext = { policy };
  const result = engine.route(candidates, context);

  const allAllocations = [
    ...result.primary,
    ...result.background,
    ...result.dropped,
  ].sort((a, b) => a.rank - b.rank);

  const bAllocations = allAllocations.filter((a) =>
    allMemories.find((m) => m.memory_id === a.candidateId)?.semantic_cluster === "cluster-b",
  );

  const clusterBPrimaryCount = result.primary.filter((a) =>
    allMemories.find((m) => m.memory_id === a.candidateId)?.semantic_cluster === "cluster-b",
  ).length;

  const clusterBAvgRank = bAllocations.length > 0
    ? bAllocations.reduce((sum, a) => sum + a.rank, 0) / bAllocations.length
    : 999;

  const clusterBAvgSalience = bAllocations.length > 0
    ? bAllocations.reduce((sum, a) => sum + a.salience, 0) / bAllocations.length
    : 0;

  // Compare engine ranking to harness flat-score ranking (cold start, T same)
  const harnessScored = allMemories
    .map((m) => ({ id: m.memory_id, score: m.importance_score + T * (1 - m.usage_frequency) }))
    .sort((a, b) => b.score - a.score);
  const harnessTop5 = harnessScored.slice(0, 5).map((m) => m.id);
  const primaryIds = result.primary.map((a) => a.candidateId);
  const agreementCount = primaryIds.filter((id) => harnessTop5.includes(id)).length;

  return {
    T,
    rankings: allAllocations.map((a) => ({
      memoryId: a.candidateId,
      cluster: allMemories.find((m) => m.memory_id === a.candidateId)?.semantic_cluster ?? "?",
      salience: a.salience,
      rank: a.rank,
      lane: a.lane,
    })),
    clusterBPrimaryCount,
    clusterBAvgRank,
    clusterBAvgSalience,
    primaryIds,
    harnessTop5,
    harnessEngineAgreement: agreementCount / Math.max(primaryIds.length, 1),
  };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAll<T>(
  client: ReturnType<typeof createOpenSearchClient>,
  index: string,
  source: string[],
): Promise<T[]> {
  const r = await client.search({ index, body: { size: 50, query: { match_all: {} }, _source: source } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.body as any).hits.hits.map((h: any) => h._source as T);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`\nExperiment 6 — Graph Diversity Slot + AttentionEngine Integration`);
  console.log(`OpenSearch: ${config.node}\n`);

  const client = createOpenSearchClient(config);
  const [allMemories, links] = await Promise.all([
    fetchAll<SemanticDoc>(client, "memory_semantic", ["memory_id","semantic_cluster","importance_score","usage_frequency","summary"]),
    fetchAll<LinkDoc>(client, "memory_links", ["link_id","source_memory_id","target_memory_id","relationship_type","strength"]),
  ]);
  console.log(`Loaded ${allMemories.length} memories, ${links.length} links\n`);

  // ── Part A ──────────────────────────────────────────────────────────────

  console.log("PART A — Graph Diversity Slot");
  console.log("─".repeat(60));
  const strategies: Strategy[] = ["flat", "graph-scored", "graph-slot"];
  const partAResults: PartAResult[] = [];

  for (const T of T_VALUES) {
    for (const strategy of strategies) {
      const r = runPartA(allMemories, links, strategy, T);
      partAResults.push(r);
      process.stdout.write(
        `  ${strategy.padEnd(14)} T=${T}  hitRate=${(r.hitRate*100).toFixed(0)}%  ` +
        `b3=${(r.b3HitRate*100).toFixed(0)}%  c1=${(r.c1SurfaceRate*100).toFixed(0)}%  ` +
        `slot=${(r.graphSlotUsedRate*100).toFixed(0)}%\n`
      );
    }
  }

  // Part A summary table
  console.log("\nPart A — b3 hit rate by strategy and T:");
  console.log(`${"strategy".padEnd(16)} ${T_VALUES.map((t) => `T=${t}`.padEnd(10)).join("")}`);
  console.log("─".repeat(46));
  for (const strategy of strategies) {
    const row = T_VALUES.map((T) => {
      const r = partAResults.find((x) => x.strategy === strategy && x.T === T)!;
      return `${(r.b3HitRate*100).toFixed(0)}%`.padEnd(10);
    }).join("");
    console.log(`${strategy.padEnd(16)} ${row}`);
  }

  // Per-turn slot usage for graph-slot at T=0.9
  const slotRun = partAResults.find((r) => r.strategy === "graph-slot" && r.T === 0.9)!;
  const b3TargetTurnIds = new Set(
    CORPUS_TURNS.filter((t) => t.groundTruthTargets.includes("mem-b3")).map((t) => t.turnId),
  );
  console.log(`\ngraph-slot T=0.9 — turns where mem-b3 is a target:`);
  console.log(`${"Turn".padEnd(8)} ${"b3hit?".padEnd(8)} ${"slotUsed?".padEnd(12)} ${"slotId".padEnd(12)} Retrieved`);
  console.log("─".repeat(80));
  for (const t of slotRun.turnResults) {
    if (!b3TargetTurnIds.has(t.turnId)) continue;
    console.log(
      `${t.turnId.padEnd(8)} ${(t.hitB3?"✓":"✗").padEnd(8)} ` +
      `${(t.graphSlotUsed?"yes":"no").padEnd(12)} ` +
      `${(t.graphSlotId??"-").padEnd(12)} ` +
      `[${t.retrievedIds.join(", ")}]`
    );
  }

  // ── Part B ──────────────────────────────────────────────────────────────

  console.log("\n\nPART B — AttentionEngine Integration Validation");
  console.log("─".repeat(60));
  console.log("Salience formula: importance×0.35 + relevance×0.20 + urgency×0.18 + novelty×T×0.14 + risk×0.08");
  console.log("Cluster-B has high novelty (1-usage≈0.9-0.95). T should lift B members toward primary lane.\n");

  const partBResults: AttentionRunResult[] = [];
  for (const T of T_VALUES) {
    const r = runPartB(allMemories, T);
    partBResults.push(r);

    console.log(`T=${T}:`);
    console.log(`  Primary lane (top-${r.primaryIds.length}): ${r.primaryIds.join(", ")}`);
    console.log(`  Harness top-5:                  ${r.harnessTop5.join(", ")}`);
    console.log(`  Harness/engine agreement:        ${(r.harnessEngineAgreement*100).toFixed(0)}%`);
    console.log(`  Cluster-B in primary:            ${r.clusterBPrimaryCount} members`);
    console.log(`  Cluster-B avg rank:              ${r.clusterBAvgRank.toFixed(1)}`);
    console.log(`  Cluster-B avg salience:          ${r.clusterBAvgSalience.toFixed(4)}`);
    console.log(`  Full ranking:`);
    for (const ranking of r.rankings) {
      const clusterTag = ranking.cluster.replace("cluster-", "").toUpperCase();
      const laneMark = ranking.lane === "primary" ? "●" : ranking.lane === "background" ? "○" : " ";
      console.log(
        `    ${laneMark} #${String(ranking.rank).padEnd(2)} ${ranking.memoryId.padEnd(10)} [${clusterTag}]  ` +
        `salience=${ranking.salience.toFixed(4)}  lane=${ranking.lane}`
      );
    }
    console.log();
  }

  // Part B comparison
  console.log("Part B — rank shift for cluster-B members across T:");
  const bMemIds = allMemories.filter((m) => m.semantic_cluster === "cluster-b").map((m) => m.memory_id);
  console.log(`${"memory".padEnd(12)} ${T_VALUES.map((t) => `T=${t} rank`.padEnd(12)).join("")}`);
  console.log("─".repeat(12 + T_VALUES.length * 12));
  for (const id of bMemIds) {
    const ranks = T_VALUES.map((T) => {
      const r = partBResults.find((x) => x.T === T)!;
      const entry = r.rankings.find((rk) => rk.memoryId === id);
      return `#${entry?.rank ?? "?"}`.padEnd(12);
    });
    console.log(`${id.padEnd(12)} ${ranks.join("")}`);
  }

  // ── Hypothesis checks ───────────────────────────────────────────────────

  // Part A
  const h1 = T_VALUES.every((T) => {
    const slot = partAResults.find((r) => r.strategy === "graph-slot" && r.T === T)!;
    const flat = partAResults.find((r) => r.strategy === "flat" && r.T === T)!;
    return slot.b3HitRate >= flat.b3HitRate;
  });

  const h2 = T_VALUES.some((T) => {
    const slot = partAResults.find((r) => r.strategy === "graph-slot" && r.T === T)!;
    const flat = partAResults.find((r) => r.strategy === "flat" && r.T === T)!;
    return slot.c1SurfaceRate > flat.c1SurfaceRate;
  });

  // Part B
  const lowT = partBResults.find((r) => r.T === 0.1)!;
  const highT = partBResults.find((r) => r.T === 0.9)!;

  const h3 = highT.clusterBAvgRank < lowT.clusterBAvgRank;
  const h4 = highT.clusterBPrimaryCount >= lowT.clusterBPrimaryCount;

  // Harness vs engine: do both agree cluster-A dominates at low T?
  const h5 = lowT.harnessEngineAgreement >= 0.6 && highT.harnessEngineAgreement >= 0.4;

  console.log(`
Hypothesis checks:
  Part A:
  H1: graph-slot improves b3 hit rate vs flat at all T
      ${h1 ? "✓" : "✗"} b3 rates — flat:       ${T_VALUES.map((T) => `T=${T}:${(partAResults.find((r)=>r.strategy==="flat"&&r.T===T)!.b3HitRate*100).toFixed(0)}%`).join("  ")}
               graph-slot: ${T_VALUES.map((T) => `T=${T}:${(partAResults.find((r)=>r.strategy==="graph-slot"&&r.T===T)!.b3HitRate*100).toFixed(0)}%`).join("  ")}

  H2: graph-slot increases c1 surface rate (contradicts link reachable via slot)
      ${h2 ? "✓" : "✗"} c1 rates — flat:       ${T_VALUES.map((T) => `T=${T}:${(partAResults.find((r)=>r.strategy==="flat"&&r.T===T)!.c1SurfaceRate*100).toFixed(0)}%`).join("  ")}
               graph-slot: ${T_VALUES.map((T) => `T=${T}:${(partAResults.find((r)=>r.strategy==="graph-slot"&&r.T===T)!.c1SurfaceRate*100).toFixed(0)}%`).join("  ")}

  Part B (AttentionEngine integration):
  H3: cluster-B avg rank improves (lower number) at T=0.9 vs T=0.1
      ${h3 ? "✓" : "✗"} avg rank — T=0.1: ${lowT.clusterBAvgRank.toFixed(1)}  T=0.9: ${highT.clusterBAvgRank.toFixed(1)}

  H4: cluster-B primary lane count increases at T=0.9 vs T=0.1
      ${h4 ? "✓" : "✗"} primary B members — T=0.1: ${lowT.clusterBPrimaryCount}  T=0.9: ${highT.clusterBPrimaryCount}

  H5: harness top-5 and AttentionEngine primary lane agree ≥60% at T=0.1
      ${h5 ? "✓" : "✗"} agreement — T=0.1: ${(lowT.harnessEngineAgreement*100).toFixed(0)}%  T=0.9: ${(highT.harnessEngineAgreement*100).toFixed(0)}%`);

  saveResults("exp6",
    "Graph diversity slot + AttentionEngine integration. Part A: reserved slot for graph neighbour. Part B: verify explorationFactor shifts salience in production engine.",
    {
      topK: TOP_K,
      decay: DECAY,
      tGraphScored: T_GRAPH,
      tValues: T_VALUES,
      hypotheses: { h1, h2, h3, h4, h5 },
      partA: {
        strategies,
        results: partAResults.map((r) => ({
          strategy: r.strategy,
          T: r.T,
          hitRate: r.hitRate,
          b3HitRate: r.b3HitRate,
          c1SurfaceRate: r.c1SurfaceRate,
          graphSlotUsedRate: r.graphSlotUsedRate,
          breadth: r.breadth,
          clusterCounts: r.clusterCounts,
          clusterPattern: r.turnResults.map((t) => t.clusterSlots).join(" "),
        })),
      },
      partB: {
        results: partBResults.map((r) => ({
          T: r.T,
          primaryIds: r.primaryIds,
          harnessTop5: r.harnessTop5,
          harnessEngineAgreement: r.harnessEngineAgreement,
          clusterBPrimaryCount: r.clusterBPrimaryCount,
          clusterBAvgRank: r.clusterBAvgRank,
          clusterBAvgSalience: r.clusterBAvgSalience,
          rankings: r.rankings,
        })),
      },
    },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
