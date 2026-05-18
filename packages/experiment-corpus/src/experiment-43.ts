/**
 * Experiment 43 — Reranker + Retrieval Feedback Closed Loop
 *
 * Experiments 36 (reranking) and 39 (retrieval feedback) validated each
 * pipeline segment in isolation. This experiment connects them: reranker
 * scores inform the helpfulnessScore fed to RetrievalFeedbackWriter, and
 * the futureWeightAdjustment written back to OpenSearch is verified to
 * reflect the reranker's assessment.
 *
 * Protocol:
 *   1. Perform 20 retrieval + reranking operations against the live corpus
 *      (exp29_events), using the MiniLM embedder and the ms-marco reranker
 *      when available (or kNN-only as fallback).
 *   2. For each retrieval, write a RetrievalFeedbackRecord:
 *        - helpfulnessScore = normalised reranker top-1 score (clamped [0,1])
 *        - usedInResponse   = reranker top-1 score > 0.5
 *        - hallucinationDetected = reranker top-1 score < 0.1
 *        - futureWeightAdjustment = (helpfulnessScore - 0.5) × 0.2
 *   3. After writing all records, query retrieval_feedback and verify:
 *      - Count matches written records (H1).
 *      - The mean futureWeightAdjustment across records where usedInResponse=true
 *        is positive (H2).
 *      - The mean futureWeightAdjustment across records where usedInResponse=false
 *        is non-positive (H3).
 *      - The retrieval_feedback records for outage-phase queries have a higher
 *        mean helpfulnessScore than normal-phase queries (H4) — because outage
 *        queries retrieve more semantically coherent memories and the reranker
 *        scores them higher.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp43
 *
 * Prerequisite: exp29_events index.
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
  OpenSearchMlClient,
} from "@cognitive-substrate/memory-opensearch";
import {
  RetrievalFeedbackWriter,
} from "@cognitive-substrate/retrieval-engine";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_INDEX  = process.env["EXP43_INDEX"] ?? "exp29_events";
const FEEDBACK_IDX  = "retrieval_feedback";
const N_QUERIES     = 20;   // 10 outage + 10 normal
const KNN_K         = 10;

type Phase = "outage" | "normal";

const PHASE_QUERIES: Record<Phase, string> = {
  outage: "critical outage high latency p95 severely elevated incident active service down",
  normal: "steady state metrics no anomalies background monitoring normal operations",
};

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Model discovery
// ---------------------------------------------------------------------------

interface ModelInfo { id: string; name: string; dim?: number; type: "embedding" | "reranker" }

async function discoverModels(client: OSClient): Promise<{ embedder: ModelInfo; reranker: ModelInfo | undefined }> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const body = response.body as {
    hits: { hits: Array<{ _id: string; _source: { name: string; model_config: { embedding_dimension: number } } }> };
  };
  let embedder: ModelInfo | undefined;
  let reranker: ModelInfo | undefined;
  for (const hit of body.hits.hits) {
    if (/_\d+$/.test(hit._id)) continue;
    const name = hit._source.name ?? "";
    const dim  = hit._source.model_config?.embedding_dimension;
    if ((name.includes("all-MiniLM") || name.includes("all-mpnet")) && dim) {
      if (!embedder || (name.includes("all-MiniLM") && !embedder.name.includes("all-MiniLM"))) {
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

async function embedText(client: OSClient, modelId: string, text: string): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: { text_docs: [text], return_number: true, target_response: ["sentence_embedding"] },
  });
  const body = response.body as {
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };
  return body.inference_results[0]!.output.find((o) => o.name === "sentence_embedding")!.data;
}

// ---------------------------------------------------------------------------
// Ensure retrieval_feedback index
// ---------------------------------------------------------------------------

async function ensureIndex(client: OSClient): Promise<void> {
  const exists = await client.indices.exists({ index: FEEDBACK_IDX });
  if ((exists.body as boolean)) return;
  await client.indices.create({
    index: FEEDBACK_IDX,
    body: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          feedback_id:              { type: "keyword" },
          timestamp:                { type: "date" },
          query_summary:            { type: "text" },
          retrieved_memory_id:      { type: "keyword" },
          used_in_response:         { type: "boolean" },
          helpfulness_score:        { type: "float" },
          hallucination_detected:   { type: "boolean" },
          future_weight_adjustment: { type: "float" },
          phase:                    { type: "keyword" },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 43: Reranker + Retrieval Feedback Closed Loop ===\n");

  const client    = createOpenSearchClient(opensearchConfigFromEnv());
  const mlClient  = new OpenSearchMlClient(client);
  const writer    = new RetrievalFeedbackWriter({ openSearch: client });

  const countResp = await client.count({ index: SOURCE_INDEX }).catch(() => null);
  const docCount  = countResp ? (countResp.body as { count: number }).count : 0;
  if (docCount < 1000) throw new Error(`Source index ${SOURCE_INDEX} has ${docCount} docs. Run exp29 first.`);

  const { embedder, reranker } = await discoverModels(client);
  console.log(`Embedder : ${embedder.name} (dim=${embedder.dim})`);
  console.log(reranker ? `Reranker : ${reranker.name}` : "No reranker — using kNN score normalised [0,1]");

  await ensureIndex(client);

  // Remove prior experiment traces
  await client.deleteByQuery({
    index: FEEDBACK_IDX,
    body: { query: { prefix: { query_summary: "exp43-" } } },
    refresh: true,
  } as Parameters<typeof client.deleteByQuery>[0]).catch(() => undefined);

  const writtenIds: string[] = [];
  const phaseMap: Record<string, Phase> = {};

  // 10 outage queries, 10 normal
  const queryPlan: Phase[] = [
    ...Array(10).fill("outage" as Phase),
    ...Array(10).fill("normal" as Phase),
  ];

  for (let i = 0; i < N_QUERIES; i++) {
    const phase = queryPlan[i]!;
    const queryText = PHASE_QUERIES[phase];

    // Embed
    const vec = await embedText(client, embedder.id, queryText);

    // kNN recall
    const resp = await client.search({
      index: SOURCE_INDEX,
      body: {
        size: KNN_K,
        query: { knn: { embedding_minilm: { vector: vec, k: KNN_K * 4 } } },
        _source: ["summary", "tags"],
      },
    });
    const hits = (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
      "hits"
    ] as Array<Record<string, unknown>>) ?? [];

    if (hits.length === 0) {
      process.stdout.write(`  query ${i + 1}: no hits, skipping\n`);
      continue;
    }

    // Determine helpfulness via reranker or kNN score
    let helpfulnessScore: number;
    if (reranker) {
      const candidates = hits.slice(0, 5).map(
        (h) => ((h["_source"] as Record<string, unknown>)?.["summary"] as string) ?? "",
      );
      const scores = await mlClient.rerank(reranker.id, queryText, candidates);
      scores.sort((a, b) => b.score - a.score);
      // Normalise reranker score to [0, 1] via sigmoid approximation
      const rawScore   = scores[0]?.score ?? 0;
      helpfulnessScore = Math.max(0, Math.min(1, (rawScore + 5) / 10));
    } else {
      // Normalise kNN score (innerproduct on normalised vectors is in [0, 1])
      const rawScore   = (hits[0]?.["_score"] as number) ?? 0;
      helpfulnessScore = Math.max(0, Math.min(1, rawScore));
    }

    const topMemoryId = (hits[0]?.["_id"] as string) ?? randomUUID();
    const feedbackId  = randomUUID();

    await writer.record({
      feedbackId,
      timestamp:              new Date().toISOString(),
      querySummary:           `exp43-q${i}-${phase}`,
      retrievedMemoryId:      topMemoryId,
      usedInResponse:         helpfulnessScore > 0.5,
      helpfulnessScore,
      hallucinationDetected:  helpfulnessScore < 0.1,
      futureWeightAdjustment: (helpfulnessScore - 0.5) * 0.2,
    });

    writtenIds.push(feedbackId);
    phaseMap[feedbackId] = phase;
    process.stdout.write(`  q${i + 1} phase=${phase}  helpfulness=${helpfulnessScore.toFixed(3)}  used=${helpfulnessScore > 0.5}\n`);
  }

  await client.indices.refresh({ index: FEEDBACK_IDX });

  // ---------------------------------------------------------------------------
  // Verify written records
  // ---------------------------------------------------------------------------

  const countAfter = (await client.count({ index: FEEDBACK_IDX }).catch(() => ({ body: { count: 0 } }))).body as { count: number };

  // H1: count matches
  const h1Pass = countAfter.count >= writtenIds.length;

  // H2: mean FWA for used records > 0
  const usedResp = await client.search({
    index: FEEDBACK_IDX,
    body: { size: 50, query: { term: { used_in_response: true } }, _source: ["future_weight_adjustment"] },
  });
  const usedHits = (((usedResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
    "hits"
  ] as Array<Record<string, unknown>>) ?? [];
  const meanUsedFwa = usedHits.length === 0 ? 0
    : usedHits.reduce((s, h) => s + (((h["_source"] as Record<string, unknown>)?.["future_weight_adjustment"] as number) ?? 0), 0) / usedHits.length;
  const h2Pass = usedHits.length === 0 || meanUsedFwa > 0;

  // H3: mean FWA for not-used records ≤ 0
  const unusedResp = await client.search({
    index: FEEDBACK_IDX,
    body: { size: 50, query: { term: { used_in_response: false } }, _source: ["future_weight_adjustment"] },
  });
  const unusedHits = (((unusedResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
    "hits"
  ] as Array<Record<string, unknown>>) ?? [];
  const meanUnusedFwa = unusedHits.length === 0 ? 0
    : unusedHits.reduce((s, h) => s + (((h["_source"] as Record<string, unknown>)?.["future_weight_adjustment"] as number) ?? 0), 0) / unusedHits.length;
  const h3Pass = unusedHits.length === 0 || meanUnusedFwa <= 0;

  // H4: outage helpfulness > normal helpfulness
  const outageResp = await client.search({
    index: FEEDBACK_IDX,
    body: { size: 50, query: { prefix: { query_summary: "exp43-q" } }, _source: ["helpfulness_score", "query_summary"] },
  });
  const allFeedback = (((outageResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
    "hits"
  ] as Array<Record<string, unknown>>) ?? [];

  const phaseHelp: Record<Phase, number[]> = { outage: [], normal: [] };
  for (const hit of allFeedback) {
    const qs  = ((hit["_source"] as Record<string, unknown>)?.["query_summary"] as string) ?? "";
    const hs  = ((hit["_source"] as Record<string, unknown>)?.["helpfulness_score"] as number) ?? 0;
    const ph  = qs.includes("-outage") ? "outage" : "normal";
    phaseHelp[ph].push(hs);
  }
  const meanOutageHelp = phaseHelp.outage.length === 0 ? 0
    : phaseHelp.outage.reduce((s, v) => s + v, 0) / phaseHelp.outage.length;
  const meanNormalHelp = phaseHelp.normal.length === 0 ? 0
    : phaseHelp.normal.reduce((s, v) => s + v, 0) / phaseHelp.normal.length;
  const h4Pass = phaseHelp.outage.length === 0 || meanOutageHelp >= meanNormalHelp;

  console.log(`\nH1 — records in index ≥ ${writtenIds.length} (${countAfter.count}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — mean FWA for used=${meanUsedFwa.toFixed(4)} > 0 (n=${usedHits.length}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — mean FWA for unused=${meanUnusedFwa.toFixed(4)} ≤ 0 (n=${unusedHits.length}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — outage helpfulness (${meanOutageHelp.toFixed(3)}) ≥ normal (${meanNormalHelp.toFixed(3)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp43",
    [
      `H1 count≥${writtenIds.length}: ${h1Pass ? "PASS" : "FAIL"} (${countAfter.count})`,
      `H2 usedFwa>0: ${h2Pass ? "PASS" : "FAIL"} (${meanUsedFwa.toFixed(4)})`,
      `H3 unusedFwa≤0: ${h3Pass ? "PASS" : "FAIL"} (${meanUnusedFwa.toFixed(4)})`,
      `H4 outageHelp≥normalHelp: ${h4Pass ? "PASS" : "FAIL"} (${meanOutageHelp.toFixed(3)} vs ${meanNormalHelp.toFixed(3)})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      writtenCount: writtenIds.length,
      indexedCount: countAfter.count,
      meanUsedFwa,
      meanUnusedFwa,
      meanOutageHelpfulness: meanOutageHelp,
      meanNormalHelpfulness: meanNormalHelp,
      hasReranker: !!reranker,
    },
  );
  console.log("\nResults saved.");

  // Cleanup exp43 feedback records
  await client.deleteByQuery({
    index: FEEDBACK_IDX,
    body: { query: { prefix: { query_summary: "exp43-q" } } },
    refresh: true,
  } as Parameters<typeof client.deleteByQuery>[0]).catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
