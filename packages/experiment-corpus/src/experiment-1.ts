/**
 * Experiment 1 — Flat k-NN Retrieval Baseline
 *
 * Establishes the retrieval distribution produced by pure importance-ranked
 * scalar retrieval with no exploration-temperature (T) influence. Every turn
 * in the 20-turn corpus replay issues a query that returns the top-k memories
 * sorted by `importance_score` descending, with no policy weighting.
 *
 * Measurements per turn:
 *   - hit@k  — whether any ground-truth target appears in the top-k results
 *   - hitIds — which ground-truth IDs were actually retrieved
 *
 * Aggregate measurements across all turns:
 *   - hitRate        — fraction of turns with at least one ground-truth hit
 *   - breadth        — Shannon entropy of retrieved IDs, normalised to [0,1]
 *   - clusterCoverage — fraction of the 3 semantic clusters retrieved at least once
 *   - clusterCounts  — per-cluster retrieval tally
 *
 * This run uses no FrozenPolicyStore or InstrumentedPolicyEngine because T
 * has no role here — the retrieval strategy is fixed at "sort by importance".
 * Results serve as the control baseline for Experiments 2 and 3.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp1
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { RetrievalBreadthAccumulator } from "@cognitive-substrate/retrieval-engine";
import type { Client } from "@opensearch-project/opensearch";
import { CORPUS_TURNS } from "./corpus.js";
import type { CorpusMemoryId } from "./corpus.js";
import { saveResults } from "./results.js";

const TOP_K = 3;

// ---------------------------------------------------------------------------
// OpenSearch query helpers
// ---------------------------------------------------------------------------

interface SemanticHit {
  _id: string;
  _source: {
    memory_id: string;
    semantic_cluster: string;
    importance_score: number;
    summary: string;
  };
}

async function fetchTopK(client: Client, k: number): Promise<SemanticHit[]> {
  const response = await client.search({
    index: "memory_semantic",
    body: {
      size: k,
      query: { match_all: {} },
      sort: [{ importance_score: { order: "desc" } }],
      _source: ["memory_id", "semantic_cluster", "importance_score", "summary"],
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (response.body as any).hits.hits as SemanticHit[];
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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`\nExperiment 1 — Flat Retrieval Baseline`);
  console.log(`OpenSearch: ${config.node}`);
  console.log(`Corpus: ${CORPUS_TURNS.length} turns, top-${TOP_K} retrieval\n`);

  const client = createOpenSearchClient(config);

  // Fetch top-k once — flat importance ranking is identical for every turn
  // (no policy, no per-query weighting). Cache the result.
  const hits = await fetchTopK(client, TOP_K);
  const retrievedIds = hits.map((h) => h._source.memory_id);

  console.log(`Top-${TOP_K} by importance_score (fixed across all turns):`);
  for (const hit of hits) {
    console.log(
      `  ${hit._source.memory_id.padEnd(10)} cluster=${hit._source.semantic_cluster}  importance=${hit._source.importance_score.toFixed(2)}  "${hit._source.summary.slice(0, 60)}..."`,
    );
  }
  console.log();

  // ---------------------------------------------------------------------------
  // Replay turns
  // ---------------------------------------------------------------------------

  const breadthAcc = new RetrievalBreadthAccumulator();
  const turnResults: TurnResult[] = [];
  const clusterHits = new Map<string, number>();

  for (const turn of CORPUS_TURNS) {
    const hitIds = turn.groundTruthTargets.filter((t) => retrievedIds.includes(t));
    const hit = hitIds.length > 0;

    // Feed into breadth accumulator — treat this turn's retrieval as a RetrievalResult
    breadthAcc.observe({ memories: retrievedIds.map((id) => ({ memoryId: id, index: "memory_semantic" as const, score: 0, summary: "", importanceScore: 0, lastRetrieved: "" })), queryEmbedding: [] });

    // Track cluster coverage from actual retrieved hits
    for (const h of hits) {
      const cluster = h._source.semantic_cluster;
      clusterHits.set(cluster, (clusterHits.get(cluster) ?? 0) + 1);
    }

    turnResults.push({ turnId: turn.turnId, memoryId: turn.memoryId, groundTruthTargets: turn.groundTruthTargets, retrievedIds, hitIds, hit });
  }

  // ---------------------------------------------------------------------------
  // Aggregate metrics
  // ---------------------------------------------------------------------------

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const breadth = breadthAcc.compute();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];
  const clustersReached = allClusters.filter((c) => (clusterHits.get(c) ?? 0) > 0).length;
  const clusterCoverage = clustersReached / allClusters.length;

  // ---------------------------------------------------------------------------
  // Turn-by-turn output
  // ---------------------------------------------------------------------------

  console.log("Turn results:");
  console.log(`${"Turn".padEnd(8)} ${"Memory".padEnd(10)} ${"Hit?".padEnd(6)} Ground-truth targets → retrieved hits`);
  console.log("─".repeat(80));
  for (const r of turnResults) {
    const hitMark = r.hit ? "✓" : "✗";
    const targets = r.groundTruthTargets.join(", ") || "(none)";
    const matched = r.hitIds.join(", ") || "(none)";
    console.log(`${r.turnId.padEnd(8)} ${r.memoryId.padEnd(10)} ${hitMark.padEnd(6)} targets=[${targets}]  hits=[${matched}]`);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log("\n════════════════════════════════════════");
  console.log("Experiment 1 — Results Summary");
  console.log("════════════════════════════════════════");
  console.log(`Hit rate (≥1 ground-truth in top-${TOP_K}): ${(hitRate * 100).toFixed(1)}%  (${turnResults.filter((r) => r.hit).length}/${turnResults.length} turns)`);
  console.log(`Retrieval breadth (Shannon entropy):       ${breadth.breadth.toFixed(4)}  (entropy=${breadth.entropy.toFixed(4)} bits, unique IDs=${breadth.uniqueMemoryIds})`);
  console.log(`Cluster coverage:                          ${(clusterCoverage * 100).toFixed(0)}%  (${clustersReached}/${allClusters.length} clusters reached)`);
  console.log("\nCluster retrieval counts:");
  for (const cluster of allClusters) {
    console.log(`  ${cluster}: ${clusterHits.get(cluster) ?? 0} retrievals`);
  }
  console.log("\nRetrieval distribution (all turns):");
  for (const { memoryId, count } of breadth.distribution) {
    const bar = "█".repeat(Math.round((count / breadth.totalReferences) * 30));
    console.log(`  ${memoryId.padEnd(10)} ${String(count).padStart(3)}  ${bar}`);
  }
  console.log(`\nInterpretation:`);
  console.log(`  breadth=0 means retrieval was perfectly concentrated (same IDs every turn).`);
  console.log(`  breadth=1 means every retrieved memory was unique across the run.`);
  console.log(`  Flat importance ranking will concentrate on high-importance cluster-A memories.`);
  console.log(`  Experiment 2 will show whether high-T broadens this distribution.`);

  saveResults("exp1", "Flat importance-ranked retrieval, no T influence. Cluster-B invisible at top-3.", {
    topK: TOP_K,
    hitRate,
    hits: turnResults.filter((r) => r.hit).length,
    total: turnResults.length,
    breadth: breadth.breadth,
    entropy: breadth.entropy,
    uniqueMemoryIds: breadth.uniqueMemoryIds,
    clusterCoverage,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    distribution: breadth.distribution,
    turns: turnResults,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
