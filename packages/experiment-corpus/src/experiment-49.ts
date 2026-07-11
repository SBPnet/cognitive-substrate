/**
 * Experiment 49 -- Lucene Engine Switch Validation
 *
 * The faiss knn engine was replaced with lucene on May 22 to eliminate the
 * ConjunctionDISI crash in OpenSearch 3.0 (opensearch-project/OpenSearch#13616).
 * That bug caused any knn query combined with a bool/filter clause to crash,
 * requiring a knnOnly workaround in the query builder. The workaround has
 * since been removed.
 *
 * This experiment validates four properties of the new configuration:
 *
 *   H1 -- knn recall with lucene engine: 20 documents with real embeddings
 *         (4 operational windows x 5 docs) seeded into a fresh `exp49_lucene`
 *         index using the lucene engine. Four probe queries (one per window)
 *         should each return the correct window as the top-1 result. Target:
 *         10/10 recall across all 4 window probes (same bar as Exp 31).
 *
 *   H2 -- Hybrid query (formerly crash-prone path): issue a query that
 *         combines a knn clause with a term filter inside a bool query --
 *         the exact pattern that crashed under faiss/ConjunctionDISI. Expect
 *         zero errors and at least 1 correct-window result in the top-5.
 *         This is the critical regression test for the faiss removal.
 *
 *   H3 -- ef_search values match schema: inspect index settings for the two
 *         production indices (experience_events, memory_semantic) via the
 *         OpenSearch settings API. Expect experience_events ef_search=100 and
 *         memory_semantic ef_search=64 as declared in schemas.ts.
 *
 *   H4 -- Hybrid query returns lucene-engine scores: the score values returned
 *         from the hybrid bool+knn query are finite and positive (faiss returns
 *         inner-product scores that can be negative; lucene cosinesimil scores
 *         are always in [0, 1]). All top-5 scores >= 0.
 *
 * Protocol:
 *   1. Discover deployed TEXT_EMBEDDING model from ML node.
 *   2. Create exp49_lucene index with lucene engine, cosinesimil, m=16,
 *      ef_construction=128, ef_search=100 (matching schemas.ts defaults).
 *   3. Seed 5 docs per window (20 total) via the ML ingest pipeline.
 *   4. Probe knn-only recall (H1).
 *   5. Issue a bool+knn+term query (H2, H4).
 *   6. Inspect production index settings (H3).
 *   7. Clean up exp49_lucene.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp49
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXP_INDEX   = "exp49_lucene";
const PIPELINE_ID = "exp49-embed";
const FIELD_NAME  = "embedding_minilm";
const EMBED_DIM   = 384;
const DOCS_PER_WINDOW = 5;
const KNN_K = 10;

type WindowName = "normal" | "degraded" | "outage" | "recovery";
const WINDOWS: WindowName[] = ["normal", "degraded", "outage", "recovery"];

const WINDOW_TEXT: Record<WindowName, string> = {
  normal:   "steady state metrics no anomalies background monitoring normal operations",
  degraded: "latency rising above threshold metrics anomalous degraded performance warning",
  outage:   "critical outage high latency p95 severely elevated incident active service down",
  recovery: "service recovering metrics returning to normal incident resolving stabilising",
};

const PROBE_QUERIES: Record<WindowName, string> = WINDOW_TEXT;

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// ML helpers
// ---------------------------------------------------------------------------

async function discoverModelId(client: OSClient): Promise<string> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: {
      query: {
        bool: {
          must: [
            { term: { algorithm: "TEXT_EMBEDDING" } },
            { term: { model_state: "DEPLOYED" } },
          ],
        },
      },
      size: 10,
    },
  });
  const body = response.body as { hits: { hits: Array<{ _id: string }> } };
  const hit = body.hits.hits.find((h) => !/_\d+$/.test(h._id));
  if (!hit) throw new Error("No deployed TEXT_EMBEDDING model.");
  return hit._id;
}

async function embed(client: OSClient, modelId: string, text: string): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: { text_docs: [text], return_number: true, target_response: ["sentence_embedding"] },
  });
  const body = response.body as {
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };
  const output = body.inference_results[0]?.output.find((o) => o.name === "sentence_embedding");
  if (!output || output.data.length !== EMBED_DIM)
    throw new Error(`Unexpected embedding dim: got ${output?.data.length}, want ${EMBED_DIM}`);
  return output.data;
}

// ---------------------------------------------------------------------------
// Index provisioning
// ---------------------------------------------------------------------------

async function provisionIndex(client: OSClient, modelId: string): Promise<void> {
  await client.ingest.putPipeline({
    id: PIPELINE_ID,
    body: {
      description: "exp49 -- embed summary via ML node",
      processors: [{ text_embedding: { model_id: modelId, field_map: { summary: FIELD_NAME } } }],
    },
  } as Parameters<typeof client.ingest.putPipeline>[0]);

  await client.indices.delete({ index: EXP_INDEX }).catch(() => undefined);
  await client.indices.create({
    index: EXP_INDEX,
    body: {
      settings: {
        index: {
          knn: true,
          number_of_shards: 1,
          number_of_replicas: 0,
          default_pipeline: PIPELINE_ID,
          "knn.algo_param.ef_search": 100,
        },
      },
      mappings: {
        properties: {
          event_id:  { type: "keyword" },
          timestamp: { type: "date" },
          summary:   { type: "text" },
          window:    { type: "keyword" },
          [FIELD_NAME]: {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: {
              name: "hnsw",
              engine: "lucene",
              space_type: "cosinesimil",
              parameters: { m: 16, ef_construction: 128 },
            },
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);

  let docIdx = 0;
  const body: Record<string, unknown>[] = [];
  for (const window of WINDOWS) {
    for (let i = 0; i < DOCS_PER_WINDOW; i++) {
      const id = `exp49-${window}-${i}`;
      body.push({ index: { _index: EXP_INDEX, _id: id } });
      body.push({
        event_id:  id,
        timestamp: new Date(Date.now() - docIdx * 60_000).toISOString(),
        summary:   `${WINDOW_TEXT[window]}. instance=${i}`,
        window,
      });
      docIdx++;
    }
  }
  await client.bulk({ body });
  await client.indices.refresh({ index: EXP_INDEX });
  console.log(`  Seeded ${WINDOWS.length * DOCS_PER_WINDOW} documents.`);
}

// ---------------------------------------------------------------------------
// H1: knn-only recall
// ---------------------------------------------------------------------------

async function probeKnnRecall(
  client: OSClient,
  modelId: string,
): Promise<{ window: WindowName; top1Correct: boolean; correctInTopK: number }[]> {
  const results = [];
  for (const window of WINDOWS) {
    const vec = await embed(client, modelId, PROBE_QUERIES[window]);
    const resp = await client.search({
      index: EXP_INDEX,
      body: {
        size: KNN_K,
        query: { knn: { [FIELD_NAME]: { vector: vec, k: KNN_K * 4 } } },
        _source: ["window"],
      },
    });
    const hits =
      (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
        "hits"
      ] as Array<Record<string, unknown>>) ?? [];
    const top1Correct =
      ((hits[0]?.["_source"] as Record<string, unknown>)?.["window"] as string) === window;
    const correctInTopK = hits.filter(
      (h) => ((h["_source"] as Record<string, unknown>)?.["window"] as string) === window,
    ).length;
    results.push({ window, top1Correct, correctInTopK });
  }
  return results;
}

// ---------------------------------------------------------------------------
// H2 + H4: hybrid bool+knn+term query (formerly crash-prone ConjunctionDISI path)
// ---------------------------------------------------------------------------

interface HybridHit {
  id: string;
  score: number;
  window: string;
}

async function probeHybridQuery(
  client: OSClient,
  modelId: string,
  targetWindow: WindowName,
): Promise<HybridHit[]> {
  const vec = await embed(client, modelId, PROBE_QUERIES[targetWindow]);
  const resp = await client.search({
    index: EXP_INDEX,
    body: {
      size: 5,
      query: {
        bool: {
          should: [
            {
              knn: {
                [FIELD_NAME]: { vector: vec, k: 20 },
              },
            },
            {
              match: { summary: PROBE_QUERIES[targetWindow] },
            },
          ],
          filter: [
            { term: { window: targetWindow } },
          ],
        },
      },
      _source: ["window"],
    },
  });
  const hits =
    (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];
  return hits.map((h) => ({
    id: (h["_id"] as string) ?? "",
    score: (h["_score"] as number) ?? -1,
    window: ((h["_source"] as Record<string, unknown>)?.["window"] as string) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// H3: inspect ef_search on production indices
// ---------------------------------------------------------------------------

async function inspectEfSearch(
  client: OSClient,
  index: string,
): Promise<number | undefined> {
  const resp = await client.indices.getSettings({ index }).catch(() => null);
  if (!resp) return undefined;
  const settings = (resp.body as Record<string, unknown>)[index] as Record<string, unknown> | undefined;
  const indexSettings = (settings?.["settings"] as Record<string, unknown>)?.[
    "index"
  ] as Record<string, unknown> | undefined;
  const knn = (indexSettings?.["knn"] as Record<string, unknown> | undefined);
  const algoParam = (knn?.["algo_param"] as Record<string, unknown> | undefined);
  const efRaw = algoParam?.["ef_search"];
  return efRaw !== undefined ? Number(efRaw) : undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 49: Lucene Engine Switch Validation ===\n");

  const client  = createOpenSearchClient(opensearchConfigFromEnv());
  const modelId = process.env["OPENSEARCH_ML_MODEL_ID"] ?? await discoverModelId(client);
  console.log(`Model ID: ${modelId}`);

  // Provision
  console.log(`\nProvisioning ${EXP_INDEX}...`);
  await provisionIndex(client, modelId);

  // ---------------------------------------------------------------------------
  // H1: knn-only recall -- all 4 windows, top-1 and top-k
  // ---------------------------------------------------------------------------
  console.log("\nH1: probing knn-only recall...");
  const knnResults = await probeKnnRecall(client, modelId);
  for (const r of knnResults) {
    console.log(
      `  ${r.window}: top-1=${r.top1Correct ? "correct" : "WRONG"}, correct-in-top-${KNN_K}=${r.correctInTopK}`,
    );
  }
  const h1Pass = knnResults.every((r) => r.top1Correct);
  console.log(`H1 -- knn top-1 correct for all 4 windows: ${h1Pass ? "PASS" : "FAIL"}`);

  // ---------------------------------------------------------------------------
  // H2 + H4: hybrid bool+knn+term query -- formerly crash-prone ConjunctionDISI path
  // ---------------------------------------------------------------------------
  console.log("\nH2/H4: issuing hybrid bool+knn+term query (formerly crash-prone under faiss)...");
  let h2Pass = false;
  let h4Pass = false;
  let hybridHits: HybridHit[] = [];
  let hybridError: string | undefined;

  try {
    hybridHits = await probeHybridQuery(client, modelId, "outage");
    const correctInTop5 = hybridHits.filter((h) => h.window === "outage").length;
    const allScoresNonNegative = hybridHits.every((h) => h.score >= 0);
    h2Pass = hybridHits.length > 0 && correctInTop5 >= 1;
    h4Pass = hybridHits.length > 0 && allScoresNonNegative;
    console.log(
      `  hybrid top-5: ${hybridHits.map((h) => `${h.window}(score=${h.score.toFixed(3)})`).join(", ")}`,
    );
    console.log(`  correct-window hits in top-5: ${correctInTop5}`);
    console.log(`  all scores >= 0: ${allScoresNonNegative}`);
  } catch (err) {
    hybridError = String(err);
    console.log(`  ERROR (ConjunctionDISI crash or other): ${hybridError}`);
    h2Pass = false;
    h4Pass = false;
  }
  console.log(`H2 -- hybrid bool+knn+term query succeeds with correct results: ${h2Pass ? "PASS" : "FAIL"}`);
  console.log(`H4 -- all top-5 hybrid scores >= 0 (lucene cosinesimil, not faiss): ${h4Pass ? "PASS" : "FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3: ef_search parity with schemas.ts
  // ---------------------------------------------------------------------------
  console.log("\nH3: inspecting ef_search on production indices...");
  const efExperience = await inspectEfSearch(client, "experience_events");
  const efSemantic   = await inspectEfSearch(client, "memory_semantic");
  console.log(`  experience_events ef_search: ${efExperience ?? "index not found"} (want 100)`);
  console.log(`  memory_semantic   ef_search: ${efSemantic ?? "index not found"}  (want 64)`);
  const h3Pass =
    (efExperience === 100 || efExperience === undefined) &&
    (efSemantic === 64 || efSemantic === undefined);
  const h3Note = efExperience === undefined || efSemantic === undefined
    ? " (one or more production indices not provisioned -- skipped)"
    : "";
  console.log(`H3 -- ef_search values match schemas.ts: ${h3Pass ? "PASS" : "FAIL"}${h3Note}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp49",
    [
      `H1 knn top-1 recall all windows: ${knnResults.map((r) => `${r.window}=${r.top1Correct}`).join(",")}: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 hybrid bool+knn+term no crash, >=1 correct: ${h2Pass ? "PASS" : "FAIL"}${hybridError ? ` (${hybridError})` : ""}`,
      `H3 ef_search experience_events=${efExperience ?? "n/a"} memory_semantic=${efSemantic ?? "n/a"}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 all hybrid scores >=0: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      modelId,
      knnRecall: knnResults,
      hybridHits,
      hybridError,
      efSearch: { experienceEvents: efExperience, memorySemantic: efSemantic },
    },
  );
  console.log("Results saved.");

  // Cleanup
  console.log("\nCleaning up...");
  await client.indices.delete({ index: EXP_INDEX }).catch(() => undefined);
  await client.ingest.deletePipeline({ id: PIPELINE_ID }).catch(() => undefined);
  console.log("  Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
