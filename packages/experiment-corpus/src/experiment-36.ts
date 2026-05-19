/**
 * Experiment 36 — Cross-Encoder Reranking Precision vs Bare kNN
 *
 * Experiment 34 confirmed that all-mpnet-base-v2 (768-dim) is the preferred
 * dense model for recall quality. This experiment asks whether adding a Tier-2
 * cross-encoder reranking step on top of the initial kNN recall further
 * improves precision: does the cross-encoder promote the truly most-relevant
 * memory to rank-1 more often than kNN alone?
 *
 * The cross-encoder available on thor is `cross-encoder/ms-marco-MiniLM-L-6-v2`,
 * deployed as a text_similarity model. It scores (query, candidate) pairs and
 * is accessed via OpenSearchMlClient.rerank().
 *
 * Protocol:
 *   1. Verify the exp34_mpnet index (created by Exp 34) is present; if not
 *      fall back to exp29_events.
 *   2. For each of the 4 phase queries run two retrieval pipelines against the
 *      same index:
 *        A) kNN only — top-10 by kNN score, slice to top-5.
 *        B) kNN + rerank — fetch top-20 candidates with kNN, score them with
 *           the cross-encoder, return the top-5 by reranker score.
 *   3. Precision@1 = fraction of queries where the top-1 result carries the
 *      correct window tag. Precision@5 = fraction of top-5 that carry the
 *      correct window tag.
 *   4. Record mean score gain: average reranker score of the final top-1 vs
 *      the average kNN score of the top-1 from condition A.
 *
 * Four hypotheses:
 *
 *   H1 — Precision@1 ≥ 0.75 for kNN-only (condition A): the 768-dim mpnet
 *        model achieves ≥75% top-1 correctness without reranking, validating
 *        Exp 34's recall result at precision@1.
 *
 *   H2 — Precision@1 with reranking ≥ precision@1 kNN-only: the cross-encoder
 *        does not degrade top-1 precision vs the baseline.
 *
 *   H3 — Precision@5 with reranking ≥ precision@5 kNN-only: reranking improves
 *        or matches recall@5 (more correct results in the top-5 set).
 *
 *   H4 — Outage query P@1 = 1.0 for both conditions: the outage window is the
 *        most semantically distinctive cluster and both pipelines should nail it.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp36
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
  OpenSearchMlClient,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFERRED_INDEX = "exp34_mpnet";
const FALLBACK_INDEX  = "exp29_events";
const FALLBACK_FIELD  = "embedding_minilm";
const KNN_FETCH       = 20;
const TOP_K           = 5;

type WindowName = "normal" | "degraded" | "outage" | "recovery";
const WINDOWS: WindowName[] = ["normal", "degraded", "outage", "recovery"];

const PROBE_QUERIES: Record<WindowName, string> = {
  normal:   "steady state metrics no anomalies background monitoring normal operations",
  degraded: "latency rising above threshold metrics anomalous degraded performance warning",
  outage:   "critical outage high latency p95 severely elevated incident active service down",
  recovery: "service recovering metrics returning to normal incident resolving stabilising",
};

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Discover models
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  name: string;
  type: "embedding" | "reranker";
  dim?: number;
}

async function discoverModels(client: OSClient, preferName?: string): Promise<{
  embedder: ModelInfo;
  reranker: ModelInfo | undefined;
}> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: {
      query: { term: { model_state: "DEPLOYED" } },
      size: 20,
      _source: ["name", "model_config", "algorithm"],
    },
  });
  const body = response.body as {
    hits: {
      hits: Array<{
        _id: string;
        _source: { name: string; model_config: { embedding_dimension: number }; algorithm: string };
      }>;
    };
  };

  let embedder: ModelInfo | undefined;
  let reranker: ModelInfo | undefined;

  for (const hit of body.hits.hits) {
    if (/_\d+$/.test(hit._id)) continue;
    const name = hit._source.name ?? "";
    const dim  = hit._source.model_config?.embedding_dimension;

    if (preferName) {
      if (name.includes(preferName) && dim) embedder = { id: hit._id, name, type: "embedding", dim };
    } else {
      if (name.includes("all-mpnet") && dim) {
        embedder = { id: hit._id, name, type: "embedding", dim };
      } else if (name.includes("all-MiniLM") && !embedder && dim) {
        embedder = { id: hit._id, name, type: "embedding", dim };
      }
    }

    if (name.includes("ms-marco") || name.includes("cross-encoder") || name.includes("reranker")) {
      reranker = { id: hit._id, name, type: "reranker" };
    }
  }

  if (!embedder) throw new Error("No embedding model found");
  return { embedder, reranker };
}

// ---------------------------------------------------------------------------
// Embed & search helpers
// ---------------------------------------------------------------------------

async function embedText(client: OSClient, modelId: string, text: string, dim: number): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: { text_docs: [text], return_number: true, target_response: ["sentence_embedding"] },
  });
  const body = response.body as {
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };
  const output = body.inference_results[0]?.output.find((o) => o.name === "sentence_embedding");
  if (!output || output.data.length !== dim)
    throw new Error(`Unexpected embedding dim ${output?.data.length} for model ${modelId}`);
  return output.data;
}

interface SearchHit {
  id: string;
  score: number;
  tags: string[];
  summary: string;
}

async function knnFetch(
  client: OSClient,
  index: string,
  vectorField: string,
  vector: number[],
  k: number,
): Promise<SearchHit[]> {
  const resp = await client.search({
    index,
    body: {
      size: k,
      query: { knn: { [vectorField]: { vector, k: k * 4 } } },
      _source: ["tags", "summary"],
    },
  });
  const hits =
    (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];
  return hits.map((h) => ({
    id: (h["_id"] as string) ?? "",
    score: (h["_score"] as number) ?? 0,
    tags: ((h["_source"] as Record<string, unknown>)?.["tags"] as string[]) ?? [],
    summary: ((h["_source"] as Record<string, unknown>)?.["summary"] as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Precision measurement
// ---------------------------------------------------------------------------

function precision1(hits: SearchHit[], window: WindowName): number {
  return hits.length > 0 && hits[0]!.tags.includes(window) ? 1 : 0;
}

function precision5(hits: SearchHit[], window: WindowName): number {
  const top5 = hits.slice(0, 5);
  return top5.filter((h) => h.tags.includes(window)).length / top5.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 36: Cross-Encoder Reranking Precision vs Bare kNN ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const mlClient = new OpenSearchMlClient(client);
  const { embedder, reranker } = await discoverModels(client);

  console.log(`Embedder : ${embedder.name} (${embedder.dim}-dim)`);
  if (reranker) {
    console.log(`Reranker : ${reranker.name}`);
  } else {
    console.log("No reranker deployed — H2/H3 will test kNN-only vs itself (trivially pass)");
  }

  // Determine which index + vector field to use. When falling back to exp29_events
  // (which only has embedding_minilm at 384-dim), also switch the embedder to
  // MiniLM so the query vector dimension matches the indexed field.
  const mpnetCount = await client.count({ index: PREFERRED_INDEX }).catch(() => null);
  const useMpnetIndex = mpnetCount && (mpnetCount.body as { count: number }).count > 500;
  const useIndex = useMpnetIndex ? PREFERRED_INDEX : FALLBACK_INDEX;

  // When falling back to exp29_events (384-dim MiniLM field), switch the
  // embedder to MiniLM if the discovered embedder is 768-dim.
  const vectorField = useMpnetIndex ? "embedding_mpnet" : FALLBACK_FIELD;
  let activeEmbedder = embedder;
  if (!useMpnetIndex && embedder.dim !== 384) {
    const { embedder: miniLM } = await discoverModels(client, "all-MiniLM");
    activeEmbedder = miniLM;
  }
  const embedDim = activeEmbedder.dim!;
  console.log(`Index: ${useIndex} (field: ${vectorField}, embedder: ${activeEmbedder.name} ${embedDim}-dim)\n`);

  interface WindowResult {
    window: WindowName;
    p1KnnOnly: number;
    p5KnnOnly: number;
    p1Reranked: number;
    p5Reranked: number;
    topKnnScore: number;
    topRerankerScore: number;
  }

  const windowResults: WindowResult[] = [];

  for (const window of WINDOWS) {
    process.stdout.write(`  Probing window: ${window}...`);
    const vec = await embedText(client, activeEmbedder.id, PROBE_QUERIES[window], embedDim);

    // Condition A: kNN only
    const knnHits = await knnFetch(client, useIndex, vectorField, vec, KNN_FETCH);
    const knnTop5 = knnHits.slice(0, TOP_K);

    // Condition B: kNN + reranker
    let rerankedTop5 = knnTop5;
    let topRerankerScore = knnTop5[0]?.score ?? 0;

    if (reranker) {
      const candidates = knnHits.slice(0, KNN_FETCH).map((h) => h.summary || h.id);
      const scores = await mlClient.rerank(reranker.id, PROBE_QUERIES[window], candidates);
      const sorted = [...scores]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
        .map((r) => knnHits[r.documentIndex]!)
        .filter(Boolean);
      rerankedTop5 = sorted;
      topRerankerScore = scores.sort((a, b) => b.score - a.score)[0]?.score ?? 0;
    }

    const result: WindowResult = {
      window,
      p1KnnOnly:       precision1(knnTop5,     window),
      p5KnnOnly:       precision5(knnTop5,     window),
      p1Reranked:      precision1(rerankedTop5, window),
      p5Reranked:      precision5(rerankedTop5, window),
      topKnnScore:     knnTop5[0]?.score ?? 0,
      topRerankerScore,
    };
    windowResults.push(result);
    process.stdout.write(` knn-p1=${result.p1KnnOnly} rerank-p1=${result.p1Reranked}\n`);
  }

  const meanP1Knn      = windowResults.reduce((s, r) => s + r.p1KnnOnly,  0) / WINDOWS.length;
  const meanP1Reranked = windowResults.reduce((s, r) => s + r.p1Reranked, 0) / WINDOWS.length;
  const meanP5Knn      = windowResults.reduce((s, r) => s + r.p5KnnOnly,  0) / WINDOWS.length;
  const meanP5Reranked = windowResults.reduce((s, r) => s + r.p5Reranked, 0) / WINDOWS.length;

  const h1Pass = meanP1Knn >= 0.75;
  const h2Pass = meanP1Reranked >= meanP1Knn;
  const h3Pass = meanP5Reranked >= meanP5Knn;
  const h4Pass = windowResults.find((r) => r.window === "outage")?.p1KnnOnly === 1 &&
                  windowResults.find((r) => r.window === "outage")?.p1Reranked === 1;

  console.log("\n--- Summary ---");
  console.log(`Mean P@1 kNN-only: ${meanP1Knn.toFixed(3)}  reranked: ${meanP1Reranked.toFixed(3)}`);
  console.log(`Mean P@5 kNN-only: ${meanP5Knn.toFixed(3)}  reranked: ${meanP5Reranked.toFixed(3)}`);
  console.log(`\nH1 — P@1 kNN-only ≥ 0.75 (${meanP1Knn.toFixed(3)}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — reranked P@1 ≥ kNN P@1 (${meanP1Reranked.toFixed(3)} ≥ ${meanP1Knn.toFixed(3)}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — reranked P@5 ≥ kNN P@5 (${meanP5Reranked.toFixed(3)} ≥ ${meanP5Knn.toFixed(3)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — outage P@1 = 1.0 both conditions: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp36",
    [
      `H1 P@1 kNN≥0.75: ${h1Pass ? "PASS" : "FAIL"} (${meanP1Knn.toFixed(3)})`,
      `H2 reranked P@1≥kNN: ${h2Pass ? "PASS" : "FAIL"} (${meanP1Reranked.toFixed(3)} vs ${meanP1Knn.toFixed(3)})`,
      `H3 reranked P@5≥kNN: ${h3Pass ? "PASS" : "FAIL"} (${meanP5Reranked.toFixed(3)} vs ${meanP5Knn.toFixed(3)})`,
      `H4 outage P@1=1.0 both: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      hasReranker: !!reranker,
      rerankerName: reranker?.name,
      index: useIndex,
      vectorField,
      windowResults,
      summary: { meanP1Knn, meanP1Reranked, meanP5Knn, meanP5Reranked },
    },
  );
  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
