/**
 * Experiment 7 — Reinforcement Loop Closure
 *
 * Verifies that the ReinforcementEngine.evaluate feedback cycle actually
 * modifies OpenSearch document fields (retrieval_priority, decay_factor,
 * reinforcement_score) and that those changes shift subsequent retrieval
 * rankings — proving the loop is live end-to-end, not just wired in theory.
 *
 * Four hypotheses:
 *
 *   H1 — After 6 high-reinforcement turns on cluster-A memories, their
 *        retrieval_priority in OpenSearch increases by ≥ 0.05 over their
 *        initial importanceScore. Reinforcement lifts trusted memories.
 *
 *   H2 — Cluster-C memories (high contradictionRisk) finish reinforcement
 *        with retrieval_priority < their initial importanceScore. Contradiction
 *        penalty suppresses low-value memories.
 *
 *   H3 — The top-5 function_score ranking after reinforcement differs from
 *        the pre-reinforcement ranking for at least one position. The loop
 *        changes what gets retrieved next.
 *
 *   H4 — Cluster-B memories reinforced during turns 7–10 (high novelty) gain
 *        enough retrieval_priority to enter the top-5 at T=0.5 in a
 *        post-reinforcement flat query — proving exploration gains persist.
 *
 * Protocol:
 *   1. Snapshot retrieval_priority for all 9 corpus memories (pre-state).
 *   2. Run the 20-turn CORPUS_TURNS replay through ReinforcementEngine.evaluate
 *      with an OpenSearch client, so each turn writes back to the index.
 *   3. Snapshot retrieval_priority again (post-state).
 *   4. Run a function_score retrieval query at T=0.5 on both snapshots.
 *   5. Compare rankings and priority deltas.
 *
 * After the experiment, documents are restored to their initial state so
 * subsequent experiments remain reproducible.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp7
 */

import {
  createOpenSearchClient,
  getDocument,
  search,
  updateDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const TOP_K = 5;
const T = 0.5; // post-reinforcement retrieval temperature

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc {
  memory_id: string;
  semantic_cluster: string;
  importance_score: number;
  usage_frequency: number;
  retrieval_priority: number;
  decay_factor: number;
  reinforcement_score: number;
  summary: string;
}

interface PrioritySnapshot {
  memoryId: string;
  cluster: string;
  retrievalPriority: number;
  importanceScore: number;
}

interface RankedResult {
  memoryId: string;
  cluster: string;
  score: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// Snapshot helper
// ---------------------------------------------------------------------------

async function snapshotPriorities(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<Map<string, PrioritySnapshot>> {
  const map = new Map<string, PrioritySnapshot>();
  for (const id of ALL_MEMORY_IDS) {
    const doc = await getDocument<SemanticDoc>(client, INDEX, id);
    if (!doc) throw new Error(`Missing document: ${id}`);
    // retrieval_priority is only written by ReinforcementEngine; fall back to
    // importance_score when it hasn't been set yet (fresh corpus documents).
    const rp = typeof doc.retrieval_priority === "number" && doc.retrieval_priority > 0
      ? doc.retrieval_priority
      : doc.importance_score;
    map.set(id, {
      memoryId: id,
      cluster: doc.semantic_cluster,
      retrievalPriority: rp,
      importanceScore: doc.importance_score,
    });
  }
  return map;
}

/**
 * Initialise retrieval_priority = importance_score on any document that
 * doesn't have it yet, so the Painless script can read a numeric value.
 */
async function ensureRetrievalPriority(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<void> {
  for (const memory of CORPUS_MEMORIES) {
    const doc = await getDocument<SemanticDoc>(client, INDEX, memory.memoryId);
    if (!doc) continue;
    if (typeof doc.retrieval_priority !== "number" || doc.retrieval_priority === 0) {
      await updateDocument(client, INDEX, memory.memoryId, {
        retrieval_priority: memory.importanceScore,  // SemanticMemory field name
      });
    }
  }
}

// ---------------------------------------------------------------------------
// function_score retrieval using retrieval_priority field
// ---------------------------------------------------------------------------

async function retrievalQuery(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<RankedResult[]> {
  const hits = await search<SemanticDoc>(client, INDEX, {
    size: TOP_K,
    query: {
      function_score: {
        query: { match_all: {} },
        functions: [
          {
            script_score: {
              script: {
                // retrieval_priority is guaranteed present after ensureRetrievalPriority.
                // usage_frequency is mapped integer, cast to double for arithmetic.
                source: `
                  double rp = doc['retrieval_priority'].value;
                  double usage = (double) doc['usage_frequency'].value;
                  return rp + ${T} * (1.0 - usage);
                `,
              },
            },
          },
        ],
        boost_mode: "replace",
      },
    },
  });

  return hits.map((hit, i) => ({
    memoryId: hit._source.memory_id,
    cluster: hit._source.semantic_cluster,
    score: hit._score,
    rank: i + 1,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const engine = new ReinforcementEngine({ openSearch: client });

  console.log("=== Experiment 7: Reinforcement Loop Closure ===\n");

  // 1. Ensure retrieval_priority is initialised on all corpus documents
  console.log("Initialising retrieval_priority from importance_score where missing...");
  await ensureRetrievalPriority(client);

  // 2. Pre-reinforcement snapshot
  console.log("Snapshotting pre-reinforcement retrieval_priority...");
  const preBefore = await snapshotPriorities(client);
  const preRanking = await retrievalQuery(client);

  console.log("Pre-reinforcement top-5:");
  for (const r of preRanking) {
    console.log(`  #${r.rank} ${r.memoryId} (${r.cluster}) score=${r.score.toFixed(4)}`);
  }

  // 2. Run 20-turn replay through ReinforcementEngine
  console.log("\nRunning 20-turn CORPUS_TURNS replay through ReinforcementEngine...");
  const updateLog: Array<{
    turnId: string;
    memoryId: string;
    preRp: number;
    reinforcement: number;
    newRp: number;
    policyDelta: number;
  }> = [];

  for (const turn of CORPUS_TURNS) {
    const pre = preBefore.get(turn.memoryId)!;
    const update = await engine.evaluate({
      memoryId: turn.memoryId,
      memoryIndex: INDEX,
      signal: turn.signal,
    });

    updateLog.push({
      turnId: turn.turnId,
      memoryId: turn.memoryId,
      preRp: pre.retrievalPriority,
      reinforcement: update.result.reinforcement,
      newRp: update.result.retrievalPriority,
      policyDelta: update.result.policyDelta,
    });

    console.log(
      `  ${turn.turnId} ${turn.memoryId}: reinf=${update.result.reinforcement.toFixed(3)} ` +
        `rp: ${pre.retrievalPriority.toFixed(3)} → ${update.result.retrievalPriority.toFixed(3)}`,
    );
  }

  // 3. Post-reinforcement snapshot
  console.log("\nSnapshotting post-reinforcement retrieval_priority...");
  const postSnapshot = await snapshotPriorities(client);
  const postRanking = await retrievalQuery(client);

  console.log("Post-reinforcement top-5:");
  for (const r of postRanking) {
    console.log(`  #${r.rank} ${r.memoryId} (${r.cluster}) score=${r.score.toFixed(4)}`);
  }

  // ---------------------------------------------------------------------------
  // Hypothesis evaluation
  // ---------------------------------------------------------------------------

  // H1: cluster-A memories gain ≥ 0.05 retrieval_priority vs importanceScore
  const clusterAIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-a"));
  const clusterADeltas = clusterAIds.map((id) => {
    const snap = postSnapshot.get(id)!;
    return { id, delta: snap.retrievalPriority - snap.importanceScore };
  });
  const h1Pass = clusterADeltas.every((d) => d.delta >= 0.05);
  console.log("\nH1 — cluster-A retrieval_priority gain ≥ 0.05:");
  for (const d of clusterADeltas) {
    console.log(`  ${d.id}: delta=${d.delta.toFixed(4)} ${d.delta >= 0.05 ? "✓" : "✗"}`);
  }
  console.log(`  Result: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: cluster-C retrieval_priority < importanceScore after reinforcement
  const clusterCIds = ALL_MEMORY_IDS.filter((id) => id.startsWith("mem-c"));
  const clusterCDeltas = clusterCIds.map((id) => {
    const snap = postSnapshot.get(id)!;
    return { id, rp: snap.retrievalPriority, imp: snap.importanceScore };
  });
  const h2Pass = clusterCDeltas.every((d) => d.rp < d.imp);
  console.log("\nH2 — cluster-C retrieval_priority < importanceScore:");
  for (const d of clusterCDeltas) {
    console.log(`  ${d.id}: rp=${d.rp.toFixed(4)} imp=${d.imp.toFixed(4)} ${d.rp < d.imp ? "✓" : "✗"}`);
  }
  console.log(`  Result: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: at least one rank position differs between pre and post rankings
  const rankDiffers = preRanking.some((pre, i) => pre.memoryId !== postRanking[i]?.memoryId);
  console.log("\nH3 — ranking changes after reinforcement:");
  console.log(`  pre:  ${preRanking.map((r) => r.memoryId).join(", ")}`);
  console.log(`  post: ${postRanking.map((r) => r.memoryId).join(", ")}`);
  console.log(`  Result: ${rankDiffers ? "✓ PASS" : "✗ FAIL"}`);

  // H4: cluster-B in post top-5
  const clusterBInTop5 = postRanking.filter((r) => r.memoryId.startsWith("mem-b"));
  const h4Pass = clusterBInTop5.length >= 1;
  console.log("\nH4 — cluster-B members in post-reinforcement top-5:");
  for (const r of clusterBInTop5) {
    console.log(`  ${r.memoryId} at rank #${r.rank}`);
  }
  if (clusterBInTop5.length === 0) console.log("  (none)");
  console.log(`  Result: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Restore pre-reinforcement state
  // ---------------------------------------------------------------------------
  console.log("\nRestoring pre-reinforcement state...");
  for (const [id, snap] of preBefore) {
    await updateDocument(client, INDEX, id, {
      retrieval_priority: snap.retrievalPriority,
      decay_factor: 0.5,
      reinforcement_score: 0,
    });
  }
  console.log("  Restored.");

  // ---------------------------------------------------------------------------
  // Save results
  // ---------------------------------------------------------------------------
  const priorityChanges = Array.from(postSnapshot.values()).map((post) => {
    const pre = preBefore.get(post.memoryId)!;
    return {
      memoryId: post.memoryId,
      cluster: post.cluster,
      importanceScore: post.importanceScore,
      preRetrievalPriority: pre.retrievalPriority,
      postRetrievalPriority: post.retrievalPriority,
      delta: post.retrievalPriority - pre.retrievalPriority,
    };
  });

  saveResults("exp7", [
    `H1 cluster-A retrieval_priority gain ≥ 0.05: ${h1Pass ? "PASS" : "FAIL"}`,
    `H2 cluster-C retrieval_priority suppressed below importanceScore: ${h2Pass ? "PASS" : "FAIL"}`,
    `H3 ranking shifts after reinforcement: ${rankDiffers ? "PASS" : "FAIL"}`,
    `H4 cluster-B enters post-reinforcement top-5 at T=0.5: ${h4Pass ? "PASS" : "FAIL"}`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: rankDiffers, h4: h4Pass },
    preRanking,
    postRanking,
    priorityChanges,
    updateLog,
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
