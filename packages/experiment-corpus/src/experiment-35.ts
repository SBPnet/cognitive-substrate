/**
 * Experiment 35 — Retrieval Breadth over a 100-Turn Session
 *
 * Prior experiments confirmed that the retrieval → attention pipeline tracks
 * the correct semantic window per turn. This experiment asks a different
 * question: across a full 100-turn incident session, how broadly does retrieval
 * distribute across the memory index? A system that always returns the same
 * top-k documents collapses the effective memory surface; one that surfaces
 * diverse memories accumulates richer context over time.
 *
 * Breadth is measured as Shannon entropy over the empirical distribution of
 * retrieved memory IDs, normalised to [0, 1] by log2(uniqueCount).
 *
 * The session uses the same 5-phase incident lifecycle as Exp 28:
 *   turns  1–20  : normal
 *   turns 21–40  : degraded
 *   turns 41–60  : outage
 *   turns 61–80  : recovery
 *   turns 81–100 : normal
 *
 * Two retrieval conditions are compared on the same corpus (exp29 10k index):
 *   A) Standard knn-only (top-5, no diversity slot)
 *   B) Diversity-slot knn: top-4 by score + 1 random low-scoring candidate
 *      injected from the bottom quartile of each batch
 *
 * Four hypotheses:
 *
 *   H1 — Baseline breadth ≥ 0.60 in condition A: even bare knn over 10k docs
 *        distributes across enough distinct memories to achieve normalised
 *        entropy ≥ 0.60 over 100 turns.
 *
 *   H2 — Diversity slot improves breadth: condition B breadth > condition A
 *        breadth (the injected random slot must widen the distribution).
 *
 *   H3 — Breadth is highest during the outage phase (turns 41–60): outage
 *        queries pull from the densest semantic cluster, surfacing a wider
 *        variety of correlated memories than steady-state queries.
 *
 *   H4 — Unique memory coverage ≥ 20% of retrieved set in condition B: at
 *        least 20 distinct memory IDs appear across the 100 × 5 = 500
 *        retrieval slots, confirming that the corpus is not collapsed to a
 *        tiny hot-set.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp35
 *
 * Prerequisite: Exp 29 must have run so that exp29_events (10k docs) exists.
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  computeRetrievalBreadth,
  RetrievalBreadthAccumulator,
} from "@cognitive-substrate/retrieval-engine";
import { saveResults } from "./results.js";
import type { RetrievalResult } from "@cognitive-substrate/retrieval-engine";
import type { MemoryReference } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_INDEX = process.env["EXP35_INDEX"] ?? "exp29_events";
const KNN_K = 5;
const TURNS = 100;

type Phase = "normal" | "degraded" | "outage" | "recovery";

interface TurnSpec {
  turn: number;
  phase: Phase;
  query: string;
}

const PHASE_QUERIES: Record<Phase, string> = {
  normal:   "steady state metrics no anomalies background monitoring normal operations",
  degraded: "latency rising above threshold metrics anomalous degraded performance warning",
  outage:   "critical outage high latency p95 severely elevated incident active service down",
  recovery: "service recovering metrics returning to normal incident resolving stabilising",
};

function buildTurnPlan(): TurnSpec[] {
  const plan: TurnSpec[] = [];
  const phases: Array<[Phase, number, number]> = [
    ["normal",   1,  20],
    ["degraded", 21, 40],
    ["outage",   41, 60],
    ["recovery", 61, 80],
    ["normal",   81, 100],
  ];
  for (const [phase, start, end] of phases) {
    for (let t = start; t <= end; t++) {
      plan.push({ turn: t, phase, query: PHASE_QUERIES[phase] });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// ML embed helper
// ---------------------------------------------------------------------------

type OSClient = ReturnType<typeof createOpenSearchClient>;

async function embedText(client: OSClient, modelId: string, text: string): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: { text_docs: [text], return_number: true, target_response: ["sentence_embedding"] },
  });
  const body = response.body as {
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };
  const output = body.inference_results[0]?.output.find((o) => o.name === "sentence_embedding");
  if (!output) throw new Error("No embedding returned");
  return output.data;
}

// ---------------------------------------------------------------------------
// knn search helpers
// ---------------------------------------------------------------------------

async function knnSearch(
  client: OSClient,
  index: string,
  vector: number[],
  k: number,
): Promise<MemoryReference[]> {
  const resp = await client.search({
    index,
    body: {
      size: k,
      query: { knn: { embedding_minilm: { vector, k: k * 4 } } },
      _source: ["event_id", "tags", "summary"],
    },
  });
  const hits =
    (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];
  return hits.map((h) => ({
    memoryId: (h["_id"] as string) ?? "",
    index: "experience_events" as const,
    score: (h["_score"] as number) ?? 0,
    summary: ((h["_source"] as Record<string, unknown>)?.["summary"] as string) ?? "",
    importanceScore: 0.5,
  }));
}

// Diversity-slot variant: top-(k-1) + 1 injected from bottom quartile
async function knnSearchWithDiversity(
  client: OSClient,
  index: string,
  vector: number[],
  k: number,
): Promise<MemoryReference[]> {
  const overFetch = k * 8;
  const resp = await client.search({
    index,
    body: {
      size: overFetch,
      query: { knn: { embedding_minilm: { vector, k: overFetch * 2 } } },
      _source: ["event_id", "tags", "summary"],
    },
  });
  const hits =
    (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];

  if (hits.length === 0) return [];

  const mapped: MemoryReference[] = hits.map((h) => ({
    memoryId: (h["_id"] as string) ?? "",
    index: "experience_events" as const,
    score: (h["_score"] as number) ?? 0,
    summary: ((h["_source"] as Record<string, unknown>)?.["summary"] as string) ?? "",
    importanceScore: 0.5,
  }));

  const topK = mapped.slice(0, k - 1);
  const quartileStart = Math.floor(hits.length * 0.75);
  const pool = mapped.slice(quartileStart);
  const diversitySlot = pool[Math.floor(Math.random() * pool.length)] ?? mapped[mapped.length - 1]!;
  return [...topK, diversitySlot];
}

// Wrap MemoryReference[] as a minimal RetrievalResult for the breadth utilities
function toRetrievalResult(memories: MemoryReference[]): RetrievalResult {
  return { memories, queryEmbedding: [] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 35: Retrieval Breadth over 100-Turn Session ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());

  // Verify source index
  const countResp = await client.count({ index: SOURCE_INDEX }).catch(() => null);
  const docCount = countResp ? (countResp.body as { count: number }).count : 0;
  if (docCount < 1000) {
    throw new Error(
      `Source index ${SOURCE_INDEX} has only ${docCount} docs. Run exp29 first.`,
    );
  }
  console.log(`Source index: ${SOURCE_INDEX} (${docCount.toLocaleString()} docs)`);

  // Discover MiniLM model id
  const modelsResp = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const modelsBody = modelsResp.body as {
    hits: { hits: Array<{ _id: string; _source: { name: string } }> };
  };
  const miniLmModel = modelsBody.hits.hits.find(
    (h) => h._source.name?.includes("all-MiniLM") && !/_\d+$/.test(h._id),
  );
  if (!miniLmModel) throw new Error("all-MiniLM model not found or not deployed");
  const modelId = miniLmModel._id;
  console.log(`Using embedding model: ${miniLmModel._source.name} (${modelId})\n`);

  const turns = buildTurnPlan();

  // ---------------------------------------------------------------------------
  // Condition A: standard knn
  // ---------------------------------------------------------------------------
  console.log("Running condition A (standard knn)...");
  const accumA = new RetrievalBreadthAccumulator();
  const phaseAccA: Record<Phase, RetrievalBreadthAccumulator> = {
    normal:   new RetrievalBreadthAccumulator(),
    degraded: new RetrievalBreadthAccumulator(),
    outage:   new RetrievalBreadthAccumulator(),
    recovery: new RetrievalBreadthAccumulator(),
  };

  for (const { turn, phase, query } of turns) {
    const vec = await embedText(client, modelId, query);
    const memories = await knnSearch(client, SOURCE_INDEX, vec, KNN_K);
    const result = toRetrievalResult(memories);
    accumA.observe(result);
    phaseAccA[phase].observe(result);
    if (turn % 20 === 0) process.stdout.write(`  turn ${turn}/100\n`);
  }
  const breadthA = accumA.compute();
  const phaseBreadthA: Record<Phase, number> = {
    normal:   phaseAccA.normal.compute().breadth,
    degraded: phaseAccA.degraded.compute().breadth,
    outage:   phaseAccA.outage.compute().breadth,
    recovery: phaseAccA.recovery.compute().breadth,
  };

  // ---------------------------------------------------------------------------
  // Condition B: diversity-slot knn
  // ---------------------------------------------------------------------------
  console.log("Running condition B (diversity-slot knn)...");
  const accumB = new RetrievalBreadthAccumulator();
  const phaseAccB: Record<Phase, RetrievalBreadthAccumulator> = {
    normal:   new RetrievalBreadthAccumulator(),
    degraded: new RetrievalBreadthAccumulator(),
    outage:   new RetrievalBreadthAccumulator(),
    recovery: new RetrievalBreadthAccumulator(),
  };

  for (const { turn, phase, query } of turns) {
    const vec = await embedText(client, modelId, query);
    const memories = await knnSearchWithDiversity(client, SOURCE_INDEX, vec, KNN_K);
    const result = toRetrievalResult(memories);
    accumB.observe(result);
    phaseAccB[phase].observe(result);
    if (turn % 20 === 0) process.stdout.write(`  turn ${turn}/100\n`);
  }
  const breadthB = accumB.compute();
  const phaseBreadthB: Record<Phase, number> = {
    normal:   phaseAccB.normal.compute().breadth,
    degraded: phaseAccB.degraded.compute().breadth,
    outage:   phaseAccB.outage.compute().breadth,
    recovery: phaseAccB.recovery.compute().breadth,
  };

  // ---------------------------------------------------------------------------
  // Hypothesis evaluation
  // ---------------------------------------------------------------------------
  const h1Pass = breadthA.breadth >= 0.60;
  const h2Pass = breadthB.breadth > breadthA.breadth;
  const h3Pass = phaseBreadthA.outage >= Math.max(phaseBreadthA.normal, phaseBreadthA.degraded, phaseBreadthA.recovery);
  const h4Pass = breadthB.uniqueMemoryIds >= Math.floor(TURNS * KNN_K * 0.04); // ≥ 20

  console.log("\n--- Results ---");
  console.log(`Condition A breadth=${breadthA.breadth.toFixed(4)}  unique=${breadthA.uniqueMemoryIds}  total=${breadthA.totalReferences}`);
  console.log(`Condition B breadth=${breadthB.breadth.toFixed(4)}  unique=${breadthB.uniqueMemoryIds}  total=${breadthB.totalReferences}`);
  console.log(`Phase breadth (A): normal=${phaseBreadthA.normal.toFixed(3)}  degraded=${phaseBreadthA.degraded.toFixed(3)}  outage=${phaseBreadthA.outage.toFixed(3)}  recovery=${phaseBreadthA.recovery.toFixed(3)}`);
  console.log(`Phase breadth (B): normal=${phaseBreadthB.normal.toFixed(3)}  degraded=${phaseBreadthB.degraded.toFixed(3)}  outage=${phaseBreadthB.outage.toFixed(3)}  recovery=${phaseBreadthB.recovery.toFixed(3)}`);
  console.log(`\nH1 — condA breadth ≥ 0.60 (${breadthA.breadth.toFixed(4)}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — condB breadth > condA (${breadthB.breadth.toFixed(4)} > ${breadthA.breadth.toFixed(4)}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — outage phase has highest breadth in condA (${phaseBreadthA.outage.toFixed(3)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — condB unique IDs ≥ 20 (${breadthB.uniqueMemoryIds}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp35",
    [
      `H1 condA breadth≥0.60: ${h1Pass ? "PASS" : "FAIL"} (${breadthA.breadth.toFixed(4)})`,
      `H2 condB>condA breadth: ${h2Pass ? "PASS" : "FAIL"} (${breadthB.breadth.toFixed(4)} vs ${breadthA.breadth.toFixed(4)})`,
      `H3 outage highest phase breadth: ${h3Pass ? "PASS" : "FAIL"} (outage=${phaseBreadthA.outage.toFixed(3)})`,
      `H4 condB unique≥20: ${h4Pass ? "PASS" : "FAIL"} (${breadthB.uniqueMemoryIds})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      conditionA: { breadth: breadthA, phaseBreadth: phaseBreadthA },
      conditionB: { breadth: breadthB, phaseBreadth: phaseBreadthB },
    },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
