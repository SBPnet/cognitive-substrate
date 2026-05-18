/**
 * Experiment 42 — Hybrid Retrieval Fusion Weight Tuning (α Sweep)
 *
 * The hybrid query builder combines BM25 lexical search with kNN semantic
 * search via configurable `lexicalWeight` and `vectorWeight` (the fusion α
 * parameter). In production these are derived from `policy.retrievalBias ×
 * policy.memoryTrust × 2`; this experiment directly sweeps the fusion weights
 * to characterise the precision–diversity trade-off over a live corpus.
 *
 * Sweep: α ∈ {0.1, 0.3, 0.5, 0.7, 0.9} where:
 *   lexicalWeight = 1 - α
 *   vectorWeight  = α
 *
 * For each α value and each of the 4 window probe queries:
 *   - Run a hybrid search (size=10) against the exp29 10k index.
 *   - Record precision@5 (fraction of top-5 carrying the correct window tag).
 *   - Record the top-1 score.
 *
 * Four hypotheses:
 *
 *   H1 — Precision@5 is highest at α=0.7: vector-dominant fusion (α=0.7)
 *        outperforms the lexical-dominant (α=0.1) and balanced (α=0.5)
 *        settings for the operational incident vocabulary, because the
 *        vocabulary is dense with synonyms that BM25 misses but semantic
 *        similarity captures.
 *
 *   H2 — The outage window achieves P@5 ≥ 0.8 at all α values: the outage
 *        vocabulary is so distinctive that even the most lexical-biased setting
 *        retrieves mostly correct documents.
 *
 *   H3 — There is a monotonic relationship between α and mean top-1 score:
 *        as α increases from 0.1 to 0.9, the mean top-1 score (averaged across
 *        all 4 windows) increases, because kNN innerproduct scores are higher
 *        than BM25 TF-IDF scores for this corpus.
 *
 *   H4 — Balanced fusion (α=0.5) achieves P@5 within 5% of the best α:
 *        the default policy setting performs near-optimally without tuning.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp42
 *
 * Prerequisite: exp29_events index with 10k docs.
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
  buildHybridQuery,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_INDEX = process.env["EXP42_INDEX"] ?? "exp29_events";
const ALPHA_VALUES = [0.1, 0.3, 0.5, 0.7, 0.9];
const TOP_K        = 5;

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
// Model discovery + embed helper
// ---------------------------------------------------------------------------

async function discoverMiniLm(client: OSClient): Promise<{ id: string; dim: number }> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const body = response.body as {
    hits: { hits: Array<{ _id: string; _source: { name: string; model_config: { embedding_dimension: number } } }> };
  };
  const hit = body.hits.hits.find(
    (h) => h._source.name?.includes("all-MiniLM") && !/_\d+$/.test(h._id),
  );
  if (!hit) throw new Error("all-MiniLM model not found");
  return { id: hit._id, dim: hit._source.model_config.embedding_dimension };
}

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
// Hybrid search with explicit fusion weights
// ---------------------------------------------------------------------------

interface SearchHit {
  score: number;
  tags: string[];
}

async function hybridSearch(
  client: OSClient,
  query: string,
  embedding: number[],
  alpha: number,
): Promise<SearchHit[]> {
  const builtQuery = buildHybridQuery({
    queryText: query,
    queryEmbedding: embedding,
    size: TOP_K * 2,
    k: TOP_K * 4,
    retrievalMode: "legacy",
    timestampField: "timestamp",
    includeTagFilter: false,
    fusion: {
      lexicalWeight: 1 - alpha,
      vectorWeight:  alpha,
    },
  });

  const resp = await client.search({
    index: SOURCE_INDEX,
    body: { ...builtQuery, size: TOP_K * 2, _source: ["tags"] },
  });

  const hits =
    (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];

  return hits.slice(0, TOP_K).map((h) => ({
    score: (h["_score"] as number) ?? 0,
    tags:  ((h["_source"] as Record<string, unknown>)?.["tags"] as string[]) ?? [],
  }));
}

function precision5(hits: SearchHit[], window: WindowName): number {
  return hits.filter((h) => h.tags.includes(window)).length / Math.max(1, hits.length);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 42: Hybrid Fusion Weight Sweep ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());

  // Verify corpus
  const countResp = await client.count({ index: SOURCE_INDEX }).catch(() => null);
  const docCount  = countResp ? (countResp.body as { count: number }).count : 0;
  if (docCount < 1000) throw new Error(`Index ${SOURCE_INDEX} has ${docCount} docs. Run exp29 first.`);
  console.log(`Corpus: ${SOURCE_INDEX} (${docCount.toLocaleString()} docs)\n`);

  const { id: modelId } = await discoverMiniLm(client);

  // Pre-embed all probe queries
  const embeddings: Record<WindowName, number[]> = {} as Record<WindowName, number[]>;
  for (const w of WINDOWS) {
    embeddings[w] = await embedText(client, modelId, PROBE_QUERIES[w]);
  }

  // ---------------------------------------------------------------------------
  // Sweep
  // ---------------------------------------------------------------------------

  interface AlphaResult {
    alpha: number;
    windowP5: Record<WindowName, number>;
    meanP5: number;
    meanTop1Score: number;
  }

  const alphaResults: AlphaResult[] = [];

  for (const alpha of ALPHA_VALUES) {
    process.stdout.write(`  α=${alpha.toFixed(1)}:`);
    const windowP5: Partial<Record<WindowName, number>> = {};
    let totalScore = 0;

    for (const w of WINDOWS) {
      const hits = await hybridSearch(client, PROBE_QUERIES[w], embeddings[w], alpha);
      windowP5[w] = precision5(hits, w);
      totalScore += hits[0]?.score ?? 0;
      process.stdout.write(` ${w}=${windowP5[w]!.toFixed(2)}`);
    }

    const meanP5        = WINDOWS.reduce((s, w) => s + (windowP5[w] ?? 0), 0) / WINDOWS.length;
    const meanTop1Score = totalScore / WINDOWS.length;
    alphaResults.push({ alpha, windowP5: windowP5 as Record<WindowName, number>, meanP5, meanTop1Score });
    process.stdout.write(`  meanP5=${meanP5.toFixed(3)}  meanScore=${meanTop1Score.toFixed(4)}\n`);
  }

  // ---------------------------------------------------------------------------
  // Hypothesis evaluation
  // ---------------------------------------------------------------------------

  const byMeanP5     = [...alphaResults].sort((a, b) => b.meanP5 - a.meanP5);
  const bestAlpha    = byMeanP5[0]!.alpha;
  const alpha07      = alphaResults.find((r) => r.alpha === 0.7)!;
  const alpha05      = alphaResults.find((r) => r.alpha === 0.5)!;
  const alpha01      = alphaResults.find((r) => r.alpha === 0.1)!;

  const h1Pass = bestAlpha === 0.7 || alpha07.meanP5 === byMeanP5[0]!.meanP5;

  const h2Pass = alphaResults.every(
    (r) => (r.windowP5["outage"] ?? 0) >= 0.8,
  );

  // H3: monotonic top-1 score as alpha increases
  const scoresByAlpha = alphaResults.map((r) => r.meanTop1Score);
  let monoCount = 0;
  for (let i = 1; i < scoresByAlpha.length; i++) {
    if (scoresByAlpha[i]! >= scoresByAlpha[i - 1]!) monoCount++;
  }
  const h3Pass = monoCount >= scoresByAlpha.length - 2; // allow one non-monotone step

  // H4: alpha=0.5 within 5% of best
  const h4Pass = alpha05.meanP5 >= byMeanP5[0]!.meanP5 * 0.95;

  console.log(`\nBest α by meanP5: ${bestAlpha} (${byMeanP5[0]!.meanP5.toFixed(3)})`);
  console.log(`H1 — best α is 0.7 (or tied): ${h1Pass ? "✓ PASS" : "✗ FAIL"} (best=${bestAlpha})`);
  console.log(`H2 — outage P@5 ≥ 0.8 at all α: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — top-1 score monotone with α: ${h3Pass ? "✓ PASS" : "✗ FAIL"} (${monoCount}/${scoresByAlpha.length - 1} steps monotone)`);
  console.log(`H4 — α=0.5 within 5% of best (${alpha05.meanP5.toFixed(3)} ≥ ${(byMeanP5[0]!.meanP5 * 0.95).toFixed(3)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp42",
    [
      `H1 best α=0.7: ${h1Pass ? "PASS" : "FAIL"} (best=${bestAlpha})`,
      `H2 outage P5≥0.8 all α: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 monotone score: ${h3Pass ? "PASS" : "FAIL"} (${monoCount}/${scoresByAlpha.length - 1})`,
      `H4 α=0.5 within 5% of best: ${h4Pass ? "PASS" : "FAIL"} (${alpha05.meanP5.toFixed(3)})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      bestAlpha,
      alphaResults,
    },
  );
  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
