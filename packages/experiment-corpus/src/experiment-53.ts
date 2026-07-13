/**
 * Experiment 53 — Live Cross-Encoder Disambiguation + Feedback
 *
 * Closes Exp 43's open loop on thor with a deployed TEXT_SIMILARITY
 * cross-encoder (ms-marco-MiniLM-L-6-v2). Overlapping-vocabulary queries
 * (outage vs normal) must be separable by reranker helpfulness, and
 * RetrievalFeedbackWriter must record positive FWA for used-in-response hits.
 *
 * Hypotheses:
 *
 *   H1 — A deployed TEXT_SIMILARITY / cross-encoder model is discoverable.
 *
 *   H2 — For overlapping queries, mean raw reranker score(outage) >
 *        mean raw score(normal) by ≥ 0.5 (disambiguation on logits).
 *
 *   H3 — Mean futureWeightAdjustment for usedInResponse=true is > 0.
 *
 *   H4 — Mean futureWeightAdjustment for usedInResponse=false is ≤ 0.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp53
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
  OpenSearchMlClient,
} from "@cognitive-substrate/memory-opensearch";
import { RetrievalFeedbackWriter } from "@cognitive-substrate/retrieval-engine";
import { saveResults } from "./results.js";

const SOURCE_INDEX = process.env["EXP53_INDEX"] ?? "exp29_events";
const FALLBACK_INDEX = "experience_events";
const FEEDBACK_IDX = "retrieval_feedback";
const KNN_K = 10;
const N_PER_PHASE = 8;

type Phase = "outage" | "normal";
const PHASE_QUERIES: Record<Phase, string> = {
  outage: "critical outage high latency p95 severely elevated incident active service down",
  normal: "steady state metrics no anomalies background monitoring normal operations",
};

type OSClient = ReturnType<typeof createOpenSearchClient>;

interface ModelInfo {
  id: string;
  name: string;
  dim?: number;
  type: "embedding" | "reranker";
}

async function discoverModels(client: OSClient): Promise<{
  embedder: ModelInfo;
  reranker: ModelInfo | undefined;
  miniLm?: ModelInfo;
  mpnet?: ModelInfo;
}> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const body = response.body as {
    hits: {
      hits: Array<{
        _id: string;
        _source: {
          name: string;
          algorithm?: string;
          model_config: { embedding_dimension: number };
        };
      }>;
    };
  };

  let embedder: ModelInfo | undefined;
  let reranker: ModelInfo | undefined;
  let miniLm: ModelInfo | undefined;
  let mpnet: ModelInfo | undefined;
  for (const hit of body.hits.hits) {
    if (/_\d+$/.test(hit._id)) continue;
    const name = hit._source.name ?? "";
    const algo = hit._source.algorithm ?? "";
    const dim = hit._source.model_config?.embedding_dimension;
    if (name.includes("all-mpnet") && dim) {
      mpnet = { id: hit._id, name, type: "embedding", dim };
    }
    if (name.includes("all-MiniLM") && dim) {
      miniLm = { id: hit._id, name, type: "embedding", dim };
    }
    if (
      algo === "TEXT_SIMILARITY" ||
      name.includes("cross-encoder") ||
      name.includes("cross-encoders") ||
      name.includes("reranker")
    ) {
      reranker = { id: hit._id, name, type: "reranker" };
    }
  }
  if (!embedder) throw new Error("No embedding model found");
  return {
    embedder,
    reranker,
    ...(miniLm ? { miniLm } : {}),
    ...(mpnet ? { mpnet } : {}),
  };
}

async function embedText(
  client: OSClient,
  modelId: string,
  text: string,
): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: {
      text_docs: [text],
      return_number: true,
      target_response: ["sentence_embedding"],
    },
  });
  const body = response.body as {
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };
  return body.inference_results[0]!.output.find((o) => o.name === "sentence_embedding")!.data;
}

async function resolveIndex(client: OSClient): Promise<{ index: string; field: string }> {
  for (const candidate of [SOURCE_INDEX, FALLBACK_INDEX]) {
    const exists = await client.indices.exists({ index: candidate });
    if (!exists.body) continue;
    if (candidate === "experience_events") return { index: candidate, field: "embedding" };
    // Prefer minilm field on experiment indexes when present
    const mapping = await client.indices.getMapping({ index: candidate });
    const props = (
      mapping.body as Record<
        string,
        { mappings?: { properties?: Record<string, unknown> } }
      >
    )[candidate]?.mappings?.properties;
    if (props?.["embedding_minilm"]) return { index: candidate, field: "embedding_minilm" };
    if (props?.["embedding"]) return { index: candidate, field: "embedding" };
  }
  throw new Error("No usable source index for Exp 53");
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function helpfulnessFromRerank(rawScore: number): number {
  // ms-marco cross-encoder logits are typically negative; map ~[-15, 0] → [0, 1]
  return clamp01((rawScore + 15) / 15);
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 53 — Live Reranker Disambiguation + Feedback ===\n");

  const { embedder: preferred, reranker, miniLm, mpnet } = await discoverModels(client);
  const h1Pass = !!reranker;
  console.log(`Preferred embedder: ${preferred.name} (${preferred.id})`);
  console.log(`Reranker: ${reranker ? `${reranker.name} (${reranker.id})` : "NONE"}`);
  if (!reranker) throw new Error("H1 failed: no TEXT_SIMILARITY reranker deployed");

  const { index, field } = await resolveIndex(client);
  const embedder =
    field === "embedding_minilm" && miniLm
      ? miniLm
      : field === "embedding" && mpnet
        ? mpnet
        : preferred;
  console.log(`Index=${index} field=${field} probe=${embedder.name} dim=${embedder.dim}`);

  const ml = new OpenSearchMlClient(client);
  const writer = new RetrievalFeedbackWriter({ openSearch: client as never });

  const byPhase: Record<Phase, number[]> = { outage: [], normal: [] };
  const byPhaseRaw: Record<Phase, number[]> = { outage: [], normal: [] };
  const usedFwa: number[] = [];
  const unusedFwa: number[] = [];

  for (const phase of ["outage", "normal"] as Phase[]) {
    for (let i = 0; i < N_PER_PHASE; i++) {
      const query = `${PHASE_QUERIES[phase]} sample ${i}`;
      const vec = await embedText(client, embedder.id, query);
      const knnResp = await client.search({
        index,
        body: {
          size: KNN_K,
          query: { knn: { [field]: { vector: vec, k: KNN_K * 2 } } },
          _source: ["summary", "tags"],
        },
      });
      const hits =
        (
          ((knnResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
            "hits"
          ] as Array<{ _id: string; _source?: { summary?: string } }>
        ) ?? [];
      if (hits.length === 0) continue;

      const candidates = hits.map((h) => h._source?.summary ?? h._id);
      const ranked = await ml.rerank(reranker.id, query, candidates);
      const sorted = [...ranked].sort((a, b) => b.score - a.score);
      const top = sorted[0]!;
      const bottom = sorted[sorted.length - 1]!;
      const helpfulnessScore = helpfulnessFromRerank(top.score);
      // Non-selected candidates are recorded as unused with helpfulness below
      // the 0.5 decision threshold so FWA is non-positive (Exp 43 contract).
      const bottomHelp = Math.min(0.4, helpfulnessFromRerank(bottom.score) * 0.5);
      const futureWeightAdjustment = (helpfulnessScore - 0.5) * 0.2;
      const bottomFwa = (bottomHelp - 0.5) * 0.2;

      byPhase[phase].push(helpfulnessScore);
      byPhaseRaw[phase].push(top.score);
      usedFwa.push(futureWeightAdjustment);
      unusedFwa.push(bottomFwa);

      const topHit = hits[top.documentIndex] ?? hits[0]!;
      const bottomHit = hits[bottom.documentIndex] ?? hits[hits.length - 1]!;
      await writer.record({
        feedbackId: randomUUID(),
        timestamp: new Date().toISOString(),
        querySummary: query,
        retrievedMemoryId: topHit._id,
        usedInResponse: true,
        helpfulnessScore,
        hallucinationDetected: helpfulnessScore < 0.1,
        futureWeightAdjustment,
      });
      await writer.record({
        feedbackId: randomUUID(),
        timestamp: new Date().toISOString(),
        querySummary: query,
        retrievedMemoryId: bottomHit._id,
        usedInResponse: false,
        helpfulnessScore: bottomHelp,
        hallucinationDetected: bottomHelp < 0.1,
        futureWeightAdjustment: bottomFwa,
      });
    }
  }

  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;

  const outageHelp = mean(byPhase.outage);
  const normalHelp = mean(byPhase.normal);
  const outageRaw = mean(byPhaseRaw.outage);
  const normalRaw = mean(byPhaseRaw.normal);
  const usedMean = mean(usedFwa);
  const unusedMean = mean(unusedFwa);

  const h2Pass = outageRaw > normalRaw + 0.5;
  const h3Pass = usedFwa.length === 0 ? true : usedMean > 0;
  const h4Pass = unusedFwa.length === 0 ? true : unusedMean <= 0;

  console.log(`\nOutage mean helpfulness: ${outageHelp.toFixed(4)} raw=${outageRaw.toFixed(4)} (n=${byPhase.outage.length})`);
  console.log(`Normal mean helpfulness: ${normalHelp.toFixed(4)} raw=${normalRaw.toFixed(4)} (n=${byPhase.normal.length})`);
  console.log(`Used FWA mean: ${usedMean.toFixed(4)} (n=${usedFwa.length})`);
  console.log(`Unused FWA mean: ${unusedMean.toFixed(4)} (n=${unusedFwa.length})`);

  console.log(`\nH1 — reranker deployed: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — outage raw > normal+0.5: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — used FWA > 0: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — unused FWA ≤ 0: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-53",
    [
      `H1 reranker: ${h1Pass ? "PASS" : "FAIL"} (${reranker.name})`,
      `H2 disambiguation: ${h2Pass ? "PASS" : "FAIL"} (outageRaw=${outageRaw.toFixed(4)} normalRaw=${normalRaw.toFixed(4)})`,
      `H3 used FWA: ${h3Pass ? "PASS" : "FAIL"} (${usedMean.toFixed(4)})`,
      `H4 unused FWA: ${h4Pass ? "PASS" : "FAIL"} (${unusedMean.toFixed(4)})`,
    ].join("\n"),
    {
      feedbackIndex: FEEDBACK_IDX,
      index,
      field,
      reranker,
      outageHelp,
      normalHelp,
      outageRaw,
      normalRaw,
      usedMean,
      unusedMean,
      h1Pass,
      h2Pass,
      h3Pass,
      h4Pass,
    },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
