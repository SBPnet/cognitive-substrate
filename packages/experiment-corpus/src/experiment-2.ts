/**
 * Experiment 2 — Fixed-T Behavioural Baselines
 *
 * Runs the 20-turn corpus replay three times with explorationFactor (T) pinned
 * at 0.1, 0.5, and 0.9 via FrozenPolicyStore. The retrieval query blends
 * importance_score with a novelty boost weighted by T:
 *
 *   score = importance_score + T × (1 - usage_frequency)
 *
 * This is implemented as an OpenSearch function_score query so no embedding
 * model is required. The novelty boost term up-weights low-usage memories
 * (cluster-B) proportionally to how high T is set.
 *
 * Per-T metrics collected:
 *   hitRate          — fraction of turns with ≥1 ground-truth in top-k
 *   breadth          — normalised Shannon entropy of retrieved ID distribution
 *   clusterCoverage  — fraction of 3 clusters reached at least once
 *   clusterCounts    — per-cluster retrieval tally across all turns
 *   perTurnHits      — per-turn hit/miss detail
 *
 * Control baseline from Experiment 1:
 *   hitRate=70%, breadth=1.0 (trivially uniform over 3 IDs), clusterCoverage=33%
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp2
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { FrozenPolicyStore } from "@cognitive-substrate/policy-engine";
import { RetrievalBreadthAccumulator } from "@cognitive-substrate/retrieval-engine";
import type { Client } from "@opensearch-project/opensearch";
import { CORPUS_TURNS } from "./corpus.js";
import type { CorpusMemoryId } from "./corpus.js";
import { createDefaultPolicyState } from "@cognitive-substrate/policy-engine";
import { saveResults } from "./results.js";

const TOP_K = 5;
const T_VALUES = [0.1, 0.5, 0.9] as const;

// ---------------------------------------------------------------------------
// Retrieval query — function_score blending importance + novelty boost
// ---------------------------------------------------------------------------

interface SemanticHit {
  _id: string;
  _score: number;
  _source: {
    memory_id: string;
    semantic_cluster: string;
    importance_score: number;
    usage_frequency: number;
    summary: string;
  };
}

/**
 * Builds an OpenSearch function_score query that scores each memory as:
 *   score = importance_score + T × (1 - usage_frequency)
 *
 * field_value_factor picks up the stored float fields directly — no scripting
 * required, so this runs on all OpenSearch tiers including serverless.
 *
 * We use two field_value_factor functions combined additively via score_mode
 * and boost_mode=replace. Because function_score doesn't support direct
 * field arithmetic natively, we approximate via two passes:
 *   fn1: weight=1.0   field=importance_score        → importance contribution
 *   fn2: weight=T     field=1-usage_frequency stub  → novelty boost
 *
 * Since field_value_factor can't compute (1-field) directly, we use a
 * script_score for the novelty term — still efficient as it runs on stored
 * doc values, not analyzed text.
 */
function buildQuery(explorationFactor: number, k: number): Record<string, unknown> {
  return {
    size: k,
    query: {
      function_score: {
        query: { match_all: {} },
        functions: [
          {
            script_score: {
              script: {
                source:
                  "def imp = doc['importance_score'].value; def usage = doc['usage_frequency'].value; return imp + params.T * (1.0 - usage);",
                params: { T: explorationFactor },
              },
            },
          },
        ],
        boost_mode: "replace",
      },
    },
    _source: ["memory_id", "semantic_cluster", "importance_score", "usage_frequency", "summary"],
  };
}

async function fetchTopK(
  client: Client,
  explorationFactor: number,
  k: number,
): Promise<SemanticHit[]> {
  const response = await client.search({
    index: "memory_semantic",
    body: buildQuery(explorationFactor, k),
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
// Single T-value run
// ---------------------------------------------------------------------------

interface RunResult {
  readonly T: number;
  readonly hitRate: number;
  readonly breadth: number;
  readonly entropy: number;
  readonly uniqueMemoryIds: number;
  readonly clusterCoverage: number;
  readonly clusterCounts: Record<string, number>;
  readonly distribution: ReadonlyArray<{ memoryId: string; count: number }>;
  readonly turnResults: ReadonlyArray<TurnResult>;
  readonly topKSnapshot: ReadonlyArray<SemanticHit>;
}

async function runForT(client: Client, T: number): Promise<RunResult> {
  // Construct a FrozenPolicyStore pinned at this T value
  const frozenState = { ...createDefaultPolicyState(), explorationFactor: T };
  const _store = new FrozenPolicyStore(frozenState); // confirms store is constructable; query uses T directly

  const breadthAcc = new RetrievalBreadthAccumulator();
  const turnResults: TurnResult[] = [];
  const clusterHits = new Map<string, number>();
  const allClusters = ["cluster-a", "cluster-b", "cluster-c"];

  // For flat-T experiments, the ranking is deterministic per T (no per-query
  // weighting beyond what T provides), so we can fetch top-k once and reuse.
  const hits = await fetchTopK(client, T, TOP_K);
  const retrievedIds = hits.map((h) => h._source.memory_id);

  for (const turn of CORPUS_TURNS) {
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

    for (const h of hits) {
      const cluster = h._source.semantic_cluster;
      clusterHits.set(cluster, (clusterHits.get(cluster) ?? 0) + 1);
    }

    turnResults.push({
      turnId: turn.turnId,
      memoryId: turn.memoryId,
      groundTruthTargets: turn.groundTruthTargets,
      retrievedIds,
      hitIds,
      hit,
    });
  }

  const hitRate = turnResults.filter((r) => r.hit).length / turnResults.length;
  const breadthResult = breadthAcc.compute();
  const clustersReached = allClusters.filter((c) => (clusterHits.get(c) ?? 0) > 0).length;

  return {
    T,
    hitRate,
    breadth: breadthResult.breadth,
    entropy: breadthResult.entropy,
    uniqueMemoryIds: breadthResult.uniqueMemoryIds,
    clusterCoverage: clustersReached / allClusters.length,
    clusterCounts: Object.fromEntries(allClusters.map((c) => [c, clusterHits.get(c) ?? 0])),
    distribution: breadthResult.distribution,
    turnResults,
    topKSnapshot: hits,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`\nExperiment 2 — Fixed-T Behavioural Baselines`);
  console.log(`OpenSearch: ${config.node}`);
  console.log(`Corpus: ${CORPUS_TURNS.length} turns, top-${TOP_K} retrieval`);
  console.log(`T values: ${T_VALUES.join(", ")}\n`);

  const client = createOpenSearchClient(config);
  const results: RunResult[] = [];

  for (const T of T_VALUES) {
    console.log(`── Running T=${T} ──────────────────────────────────────────`);
    const result = await runForT(client, T);
    results.push(result);

    console.log(`Top-${TOP_K} at T=${T}:`);
    for (const h of result.topKSnapshot) {
      console.log(
        `  ${h._source.memory_id.padEnd(10)} cluster=${h._source.semantic_cluster}  ` +
          `imp=${h._source.importance_score.toFixed(2)}  usage=${h._source.usage_frequency.toFixed(2)}  ` +
          `score=${h._score.toFixed(4)}`,
      );
    }

    console.log(`\nTurn results (T=${T}):`);
    console.log(
      `${"Turn".padEnd(8)} ${"Memory".padEnd(10)} ${"Hit?".padEnd(6)} Retrieved → hits`,
    );
    console.log("─".repeat(80));
    for (const r of result.turnResults) {
      const hitMark = r.hit ? "✓" : "✗";
      const retrieved = r.retrievedIds.join(", ");
      const matched = r.hitIds.join(", ") || "(none)";
      console.log(
        `${r.turnId.padEnd(8)} ${r.memoryId.padEnd(10)} ${hitMark.padEnd(6)} [${retrieved}]  hits=[${matched}]`,
      );
    }
    console.log();
  }

  // ---------------------------------------------------------------------------
  // Cross-T comparison table
  // ---------------------------------------------------------------------------

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("Experiment 2 — Cross-T Comparison");
  console.log("════════════════════════════════════════════════════════════");
  console.log(
    `${"Metric".padEnd(36)} ${"Exp1 (ctrl)".padEnd(14)} ${T_VALUES.map((t) => `T=${t}`.padEnd(14)).join("")}`,
  );
  console.log("─".repeat(36 + 14 + T_VALUES.length * 14));

  const rows: Array<{ label: string; ctrl: string; values: string[] }> = [
    {
      label: "Hit rate",
      ctrl: "70.0%",
      values: results.map((r) => `${(r.hitRate * 100).toFixed(1)}%`),
    },
    {
      label: "Breadth (norm. entropy)",
      ctrl: "1.000",
      values: results.map((r) => r.breadth.toFixed(3)),
    },
    {
      label: "Unique memory IDs retrieved",
      ctrl: "3",
      values: results.map((r) => String(r.uniqueMemoryIds)),
    },
    {
      label: "Cluster coverage",
      ctrl: "33%",
      values: results.map((r) => `${(r.clusterCoverage * 100).toFixed(0)}%`),
    },
    {
      label: "cluster-a retrievals",
      ctrl: "60",
      values: results.map((r) => String(r.clusterCounts["cluster-a"] ?? 0)),
    },
    {
      label: "cluster-b retrievals",
      ctrl: "0",
      values: results.map((r) => String(r.clusterCounts["cluster-b"] ?? 0)),
    },
    {
      label: "cluster-c retrievals",
      ctrl: "0",
      values: results.map((r) => String(r.clusterCounts["cluster-c"] ?? 0)),
    },
  ];

  for (const row of rows) {
    console.log(
      `${row.label.padEnd(36)} ${row.ctrl.padEnd(14)} ${row.values.map((v) => v.padEnd(14)).join("")}`,
    );
  }

  console.log("\nRetrieval distribution per T:");
  for (const result of results) {
    console.log(`  T=${result.T}:`);
    for (const { memoryId, count } of result.distribution) {
      const bar = "█".repeat(Math.round((count / (CORPUS_TURNS.length * TOP_K)) * 30));
      console.log(`    ${memoryId.padEnd(10)} ${String(count).padStart(3)}  ${bar}`);
    }
  }

  console.log(`
Hypothesis checks:
  ✓ = confirmed   ✗ = refuted   ? = inconclusive

  H1: High T surfaces cluster-B (novelty) memories`);
  const highTResult = results.find((r) => r.T === 0.9)!;
  const h1 = (highTResult.clusterCounts["cluster-b"] ?? 0) > 0;
  console.log(`     ${h1 ? "✓" : "✗"} cluster-b retrievals at T=0.9: ${highTResult.clusterCounts["cluster-b"] ?? 0}`);

  console.log(`  H2: Low T anchors on cluster-A (reliable) memories`);
  const lowTResult = results.find((r) => r.T === 0.1)!;
  const h2 = (lowTResult.clusterCounts["cluster-a"] ?? 0) === CORPUS_TURNS.length * TOP_K;
  console.log(`     ${h2 ? "✓" : "✗"} cluster-a retrievals at T=0.1: ${lowTResult.clusterCounts["cluster-a"] ?? 0}/${CORPUS_TURNS.length * TOP_K}`);

  console.log(`  H3: Hit rate degrades gracefully as T increases`);
  const hitRates = results.map((r) => r.hitRate);
  const h3 = hitRates[0]! >= hitRates[hitRates.length - 1]!;
  console.log(`     ${h3 ? "✓" : "✗"} hit rates: ${hitRates.map((r) => `${(r * 100).toFixed(0)}%`).join(" → ")}`);

  saveResults("exp2", "Fixed-T additive blend is rank-order invariant; all T values produce identical top-5. Session-relative novelty needed for T sensitivity.", {
    topK: TOP_K,
    tValues: T_VALUES,
    hypotheses: { h1, h2, h3 },
    runs: results.map((r) => ({
      T: r.T,
      hitRate: r.hitRate,
      breadth: r.breadth,
      entropy: r.entropy,
      uniqueMemoryIds: r.uniqueMemoryIds,
      clusterCoverage: r.clusterCoverage,
      clusterCounts: r.clusterCounts,
      distribution: r.distribution,
      turns: r.turnResults,
    })),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
