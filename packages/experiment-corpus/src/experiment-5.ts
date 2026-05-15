/**
 * Experiment 5 — Graph-Augmented Retrieval vs Flat Scoring
 *
 * Tests whether one-hop neighbourhood expansion over the memory_links graph
 * recovers memories that flat session-scoring misses, specifically mem-b3
 * which has no inbound links and low importance (0.55) but appears as a
 * ground-truth target in 6 of 20 corpus turns.
 *
 * Two retrieval strategies compared across T ∈ {0.1, 0.5, 0.9}, decay=0.5:
 *
 *   flat   — score = importance + T*(1-recency)    [Exp 3/4 baseline]
 *
 *   graph  — flat scoring for seed candidates, then for each seed in top-k:
 *              fetch all memory_links where source OR target = seed
 *              add linked memory to candidate pool with:
 *                graph_score = seed_score × link_strength × T_graph
 *              merge pools, de-duplicate, re-rank, return top-k
 *
 * T_graph is a separate graph-traversal temperature controlling how much
 * link strength contributes vs the seed score. Tested at T_graph ∈ {0.3, 0.7}.
 *
 * Key metrics:
 *   mem-b3 hit rate    — turns where mem-b3 appears in top-k (primary target)
 *   contradicts penalty — turns where mem-c1 surfaces (via its link to mem-a1)
 *   overall hit rate   — ground-truth recall across all turns
 *   graph expansion rate — fraction of turns where graph added new candidates
 *   link type breakdown — which relationship types contributed retrievals
 *
 * Hypothesis:
 *   H1: graph retrieval improves mem-b3 hit rate vs flat at all T values
 *   H2: contradicts links (c1→a1) surface mem-c1 more under graph — a cost
 *   H3: causal links (a1→a2, a2→a3) add redundant A-cluster hits (low value)
 *   H4: T_graph=0.7 recovers more B-cluster than T_graph=0.3
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp5
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
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
const T_VALUES = [0.1, 0.5, 0.9] as const;
const T_GRAPH_VALUES = [0.3, 0.7] as const;

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
  via?: string; // "direct" | "graph:<link_id>:<rel_type>"
  linkStrength?: number;
}

// ---------------------------------------------------------------------------
// Recency tracker (same model as Exp 3/4)
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
// Flat scoring
// ---------------------------------------------------------------------------

function flatScore(
  memories: SemanticDoc[],
  T: number,
  tracker: RecencyTracker,
): ScoredMemory[] {
  return memories.map((m) => {
    const nov = tracker.novelty(m.memory_id);
    return { ...m, novelty: nov, sessionScore: m.importance_score + T * nov, via: "direct" };
  });
}

// ---------------------------------------------------------------------------
// Graph expansion
// ---------------------------------------------------------------------------

function graphExpand(
  seeds: ScoredMemory[],
  allMemories: SemanticDoc[],
  links: LinkDoc[],
  T: number,
  Tg: number,
  tracker: RecencyTracker,
): { candidates: ScoredMemory[]; expansionCount: number; linkTypeHits: Record<string, number> } {
  const byId = new Map(allMemories.map((m) => [m.memory_id, m]));
  const seedIds = new Set(seeds.map((s) => s.memory_id));
  const expanded = new Map<string, ScoredMemory>(seeds.map((s) => [s.memory_id, s]));
  const linkTypeHits: Record<string, number> = {};
  let expansionCount = 0;

  for (const seed of seeds) {
    // Walk all links where this seed is source OR target
    const touching = links.filter(
      (l) => l.source_memory_id === seed.memory_id || l.target_memory_id === seed.memory_id,
    );

    for (const link of touching) {
      const neighborId =
        link.source_memory_id === seed.memory_id
          ? link.target_memory_id
          : link.source_memory_id;

      const neighbor = byId.get(neighborId);
      if (!neighbor) continue;

      const nov = tracker.novelty(neighborId);
      const graphScore = seed.sessionScore * link.strength * Tg + T * nov;

      if (!expanded.has(neighborId)) {
        expansionCount++;
        linkTypeHits[link.relationship_type] = (linkTypeHits[link.relationship_type] ?? 0) + 1;
      } else {
        // Keep higher score
        const existing = expanded.get(neighborId)!;
        if (graphScore <= existing.sessionScore) continue;
      }

      if (!seedIds.has(neighborId)) {
        expanded.set(neighborId, {
          ...neighbor,
          novelty: nov,
          sessionScore: graphScore,
          via: `graph:${link.link_id}:${link.relationship_type}`,
          linkStrength: link.strength,
        });
      }
    }
  }

  return { candidates: [...expanded.values()], expansionCount, linkTypeHits };
}

// ---------------------------------------------------------------------------
// Single turn retrieval
// ---------------------------------------------------------------------------

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
  readonly expansionCount: number;
  readonly viaGraph: ReadonlyArray<string>;
  readonly linkTypeHits: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Sub-run result
// ---------------------------------------------------------------------------

interface SubRunResult {
  readonly strategy: "flat" | "graph";
  readonly T: number;
  readonly Tg: number | null;
  readonly hitRate: number;
  readonly b3HitRate: number;
  readonly c1SurfaceRate: number;
  readonly breadth: number;
  readonly clusterAShare: number;
  readonly clusterBShare: number;
  readonly clusterCounts: Record<string, number>;
  readonly avgExpansionPerTurn: number;
  readonly linkTypeHits: Record<string, number>;
  readonly turnResults: ReadonlyArray<TurnResult>;
}

// ---------------------------------------------------------------------------
// Run one strategy × T (× Tg for graph)
// ---------------------------------------------------------------------------

function runStrategy(
  allMemories: SemanticDoc[],
  links: LinkDoc[],
  strategy: "flat" | "graph",
  T: number,
  Tg: number,
): SubRunResult {
  const tracker = new RecencyTracker(DECAY);
  const breadthAcc = new RetrievalBreadthAccumulator();
  const clusterHits = new Map<string, number>();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];
  const turnResults: TurnResult[] = [];
  const aggregateLinkTypeHits: Record<string, number> = {};
  let totalExpansion = 0;

  const b3Turns = new Set(
    CORPUS_TURNS.filter((t) => t.groundTruthTargets.includes("mem-b3")).map((t) => t.turnId),
  );

  for (const turn of CORPUS_TURNS) {
    const scored = flatScore(allMemories, T, tracker);

    let candidates: ScoredMemory[];
    let expansionCount = 0;
    let linkTypeHits: Record<string, number> = {};

    if (strategy === "flat") {
      candidates = scored;
    } else {
      const seeds = [...scored].sort((a, b) => b.sessionScore - a.sessionScore).slice(0, TOP_K);
      const expanded = graphExpand(seeds, allMemories, links, T, Tg, tracker);
      candidates = expanded.candidates;
      expansionCount = expanded.expansionCount;
      linkTypeHits = expanded.linkTypeHits;
      for (const [rel, count] of Object.entries(linkTypeHits)) {
        aggregateLinkTypeHits[rel] = (aggregateLinkTypeHits[rel] ?? 0) + count;
      }
    }

    totalExpansion += expansionCount;

    const topK = [...candidates]
      .sort((a, b) => b.sessionScore - a.sessionScore)
      .slice(0, TOP_K);

    const retrievedIds = topK.map((m) => m.memory_id);
    const viaGraph = topK.filter((m) => m.via?.startsWith("graph")).map((m) => m.memory_id);
    const clusterSlots = topK
      .map((m) => m.semantic_cluster.replace("cluster-", "").toUpperCase())
      .join("");

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
      expansionCount,
      viaGraph,
      linkTypeHits,
    });
  }

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const b3Turns2 = turnResults.filter((r) => b3Turns.has(r.turnId));
  const b3HitRate = b3Turns2.filter((r) => r.hitB3).length / b3Turns2.length;
  const c1SurfaceRate = turnResults.filter((r) => r.surfacedC1).length / turnResults.length;
  const breadthResult = breadthAcc.compute();
  const totalSlots = CORPUS_TURNS.length * TOP_K;

  return {
    strategy,
    T,
    Tg: strategy === "graph" ? Tg : null,
    hitRate,
    b3HitRate,
    c1SurfaceRate,
    breadth: breadthResult.breadth,
    clusterAShare: (clusterHits.get("cluster-a") ?? 0) / totalSlots,
    clusterBShare: (clusterHits.get("cluster-b") ?? 0) / totalSlots,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    avgExpansionPerTurn: totalExpansion / CORPUS_TURNS.length,
    linkTypeHits: aggregateLinkTypeHits,
    turnResults,
  };
}

// ---------------------------------------------------------------------------
// Fetch data from OpenSearch
// ---------------------------------------------------------------------------

async function fetchAllMemories(client: ReturnType<typeof createOpenSearchClient>): Promise<SemanticDoc[]> {
  const r = await client.search({
    index: "memory_semantic",
    body: { size: 50, query: { match_all: {} }, _source: ["memory_id","semantic_cluster","importance_score","usage_frequency","summary"] },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.body as any).hits.hits.map((h: any) => h._source as SemanticDoc);
}

async function fetchAllLinks(client: ReturnType<typeof createOpenSearchClient>): Promise<LinkDoc[]> {
  const r = await client.search({
    index: "memory_links",
    body: { size: 50, query: { match_all: {} }, _source: ["link_id","source_memory_id","target_memory_id","relationship_type","strength"] },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.body as any).hits.hits.map((h: any) => h._source as LinkDoc);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`\nExperiment 5 — Graph-Augmented Retrieval vs Flat Scoring`);
  console.log(`OpenSearch: ${config.node}`);
  console.log(`Corpus: ${CORPUS_TURNS.length} turns, top-${TOP_K}, decay=${DECAY}`);
  console.log(`T values: ${T_VALUES.join(", ")}  |  T_graph values: ${T_GRAPH_VALUES.join(", ")}\n`);

  const client = createOpenSearchClient(config);
  const [allMemories, links] = await Promise.all([fetchAllMemories(client), fetchAllLinks(client)]);
  console.log(`Loaded ${allMemories.length} memories, ${links.length} links\n`);

  console.log("Graph edges:");
  for (const l of links) {
    console.log(`  ${l.link_id.padEnd(16)} ${l.relationship_type.padEnd(14)} ${l.source_memory_id} → ${l.target_memory_id}  strength=${l.strength}`);
  }

  // mem-b3 appears in these turns as a target — the hard cases
  const b3TargetTurns = CORPUS_TURNS.filter((t) => t.groundTruthTargets.includes("mem-b3"));
  console.log(`\nmem-b3 is ground-truth target in ${b3TargetTurns.length} turns: ${b3TargetTurns.map((t) => t.turnId).join(", ")}`);
  console.log(`  mem-b3 has ONE outbound link: b3 -derived_from-> a1 (no inbound links)`);
  console.log(`  Graph traversal from a1 (reverse walk) is the only structural path to b3\n`);

  // Verify FrozenPolicyStore is usable (satisfy the import)
  const _store = new FrozenPolicyStore({ ...createDefaultPolicyState(), explorationFactor: 0.5 });
  void _store;

  const subRuns: SubRunResult[] = [];

  // Flat runs (baseline)
  for (const T of T_VALUES) {
    process.stdout.write(`flat  T=${T} ... `);
    const result = runStrategy(allMemories, links, "flat", T, 0);
    subRuns.push(result);
    console.log(`hitRate=${(result.hitRate*100).toFixed(0)}%  b3Hit=${(result.b3HitRate*100).toFixed(0)}%`);
  }

  // Graph runs
  for (const T of T_VALUES) {
    for (const Tg of T_GRAPH_VALUES) {
      process.stdout.write(`graph T=${T} Tg=${Tg} ... `);
      const result = runStrategy(allMemories, links, "graph", T, Tg);
      subRuns.push(result);
      console.log(`hitRate=${(result.hitRate*100).toFixed(0)}%  b3Hit=${(result.b3HitRate*100).toFixed(0)}%  c1Rate=${(result.c1SurfaceRate*100).toFixed(0)}%  expansions/turn=${result.avgExpansionPerTurn.toFixed(1)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------

  console.log("\n\n══════════════════════════════════════════════════════════════════════════════════════");
  console.log("Experiment 5 — Graph vs Flat Retrieval Summary");
  console.log("══════════════════════════════════════════════════════════════════════════════════════");
  console.log(
    `${"strategy".padEnd(7)} ${"T".padEnd(5)} ${"Tg".padEnd(5)} ` +
    `${"hitRate".padEnd(9)} ${"b3Hit".padEnd(9)} ${"c1Rate".padEnd(9)} ` +
    `${"A%".padEnd(6)} ${"B%".padEnd(6)} ${"breadth".padEnd(9)} ${"expand/t"}`,
  );
  console.log("─".repeat(90));

  for (const r of subRuns) {
    console.log(
      `${r.strategy.padEnd(7)} ${String(r.T).padEnd(5)} ${String(r.Tg ?? "-").padEnd(5)} ` +
      `${`${(r.hitRate*100).toFixed(0)}%`.padEnd(9)} ` +
      `${`${(r.b3HitRate*100).toFixed(0)}%`.padEnd(9)} ` +
      `${`${(r.c1SurfaceRate*100).toFixed(0)}%`.padEnd(9)} ` +
      `${`${(r.clusterAShare*100).toFixed(0)}%`.padEnd(6)} ` +
      `${`${(r.clusterBShare*100).toFixed(0)}%`.padEnd(6)} ` +
      `${r.breadth.toFixed(3).padEnd(9)} ` +
      `${r.avgExpansionPerTurn.toFixed(1)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Per-turn b3 recovery detail for best graph run
  // ---------------------------------------------------------------------------

  const bestGraph = subRuns
    .filter((r) => r.strategy === "graph")
    .sort((a, b) => b.b3HitRate - a.b3HitRate)[0]!;

  const b3Turns = new Set(
    CORPUS_TURNS.filter((t) => t.groundTruthTargets.includes("mem-b3")).map((t) => t.turnId),
  );

  console.log(`\nBest graph run: T=${bestGraph.T} Tg=${bestGraph.Tg} — b3 turn-by-turn:`);
  console.log(`${"Turn".padEnd(8)} ${"b3 hit?".padEnd(9)} ${"via graph?".padEnd(20)} Retrieved`);
  console.log("─".repeat(80));
  for (const t of bestGraph.turnResults) {
    if (!b3Turns.has(t.turnId)) continue;
    const b3hit = t.hitB3 ? "✓" : "✗";
    const vg = t.viaGraph.length > 0 ? t.viaGraph.join(",") : "(none)";
    console.log(`${t.turnId.padEnd(8)} ${b3hit.padEnd(9)} ${vg.padEnd(20)} [${t.retrievedIds.join(", ")}]`);
  }

  // Link type contribution
  console.log("\nLink type contributions (best graph run, all turns):");
  for (const [rel, count] of Object.entries(bestGraph.linkTypeHits).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${rel.padEnd(16)} ${count} expansion events`);
  }

  // ---------------------------------------------------------------------------
  // Hypothesis checks
  // ---------------------------------------------------------------------------

  const flatRuns = subRuns.filter((r) => r.strategy === "flat");
  const graphRuns = subRuns.filter((r) => r.strategy === "graph");

  const h1 = T_VALUES.every((T) => {
    const flat = flatRuns.find((r) => r.T === T)!;
    const graphs = graphRuns.filter((r) => r.T === T);
    return graphs.some((g) => g.b3HitRate > flat.b3HitRate);
  });

  const h2 = T_VALUES.some((T) => {
    const flat = flatRuns.find((r) => r.T === T)!;
    const graphs = graphRuns.filter((r) => r.T === T);
    return graphs.some((g) => g.c1SurfaceRate > flat.c1SurfaceRate);
  });

  const h3 = T_VALUES.every((T) => {
    const flat = flatRuns.find((r) => r.T === T)!;
    const graphs = graphRuns.filter((r) => r.T === T);
    return graphs.some((g) => {
      const causalHits = g.linkTypeHits["causal"] ?? 0;
      return causalHits > 0 && g.clusterAShare >= flat.clusterAShare;
    });
  });

  const h4 = T_VALUES.every((T) => {
    const highTg = graphRuns.find((r) => r.T === T && r.Tg === 0.7);
    const lowTg = graphRuns.find((r) => r.T === T && r.Tg === 0.3);
    return highTg && lowTg && highTg.clusterBShare >= lowTg.clusterBShare;
  });

  console.log(`
Hypothesis checks:
  H1: graph improves mem-b3 hit rate vs flat at all T
      ${h1 ? "✓" : "✗"} b3 hit rates — flat: ${flatRuns.map((r)=>`T=${r.T}:${(r.b3HitRate*100).toFixed(0)}%`).join("  ")}
               graph(best): ${T_VALUES.map((T)=>{const g=graphRuns.filter((r)=>r.T===T).sort((a,b)=>b.b3HitRate-a.b3HitRate)[0]!;return `T=${T}:${(g.b3HitRate*100).toFixed(0)}%`;}).join("  ")}

  H2: contradicts links surface mem-c1 more under graph (expected cost)
      ${h2 ? "✓" : "✗"} c1 surface rate — flat: ${flatRuns.map((r)=>`T=${r.T}:${(r.c1SurfaceRate*100).toFixed(0)}%`).join("  ")}
                          graph: ${graphRuns.map((r)=>`T=${r.T}/Tg=${r.Tg}:${(r.c1SurfaceRate*100).toFixed(0)}%`).join("  ")}

  H3: causal links add redundant cluster-A hits
      ${h3 ? "✓" : "✗"} causal link expansions: ${graphRuns.map((r)=>`T=${r.T}/Tg=${r.Tg}:${r.linkTypeHits["causal"]??0}`).join("  ")}

  H4: T_graph=0.7 recovers more cluster-B than T_graph=0.3
      ${h4 ? "✓" : "✗"} B-share by Tg: ${T_VALUES.map((T)=>T_GRAPH_VALUES.map((Tg)=>{const g=graphRuns.find((r)=>r.T===T&&r.Tg===Tg)!;return `T=${T}/Tg=${Tg}:${(g.clusterBShare*100).toFixed(0)}%`;}).join("  ")).join("  ")}`);

  saveResults(
    "exp5",
    "Graph-augmented retrieval. One-hop link expansion from top-k seeds. Primary target: mem-b3 (no inbound links, imp=0.55).",
    {
      topK: TOP_K,
      decay: DECAY,
      tValues: T_VALUES,
      tGraphValues: T_GRAPH_VALUES,
      hypotheses: { h1, h2, h3, h4 },
      graphEdges: links,
      subRuns: subRuns.map((r) => ({
        strategy: r.strategy,
        T: r.T,
        Tg: r.Tg,
        hitRate: r.hitRate,
        b3HitRate: r.b3HitRate,
        c1SurfaceRate: r.c1SurfaceRate,
        breadth: r.breadth,
        clusterAShare: r.clusterAShare,
        clusterBShare: r.clusterBShare,
        clusterCounts: r.clusterCounts,
        avgExpansionPerTurn: r.avgExpansionPerTurn,
        linkTypeHits: r.linkTypeHits,
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
