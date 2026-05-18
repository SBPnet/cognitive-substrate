/**
 * Experiment 34 — Multi-Model Embedding Quality Comparison
 *
 * Three embedding models are now deployed on the OpenSearch ML node:
 *
 *   - all-MiniLM-L6-v2         384-dim  88 MB   (baseline, all prior experiments)
 *   - msmarco-distilbert-base-tas-b  768-dim  266 MB  (MS MARCO passage retrieval)
 *   - all-mpnet-base-v2         768-dim  439 MB  (best general-purpose 768-dim)
 *
 * This experiment provisions a fresh 2k-signal corpus with a separate ingest
 * pipeline + knn_vector field for each model, then measures knn recall@10 and
 * mean top-1 score per window for all three side-by-side. The goal is to
 * determine whether upgrading from 384-dim to 768-dim improves semantic
 * retrieval quality on the operational incident vocabulary.
 *
 * Four hypotheses:
 *
 *   H1 — All models achieve ≥9/10 recall@10 for each window: the operational
 *        vocabulary is distinctive enough that all three models separate the
 *        four windows cleanly.
 *
 *   H2 — all-mpnet-base-v2 recall ≥ all-MiniLM recall: the larger 768-dim
 *        model matches or improves on the 384-dim baseline for every window.
 *
 *   H3 — all-mpnet-base-v2 mean top-1 score > all-MiniLM mean top-1 score
 *        averaged across the four windows (higher score = tighter semantic
 *        cluster = better separation).
 *
 *   H4 — msmarco-distilbert recall ≥ all-MiniLM recall for the outage window:
 *        msmarco was fine-tuned on retrieval tasks and should be strongest on
 *        the most semantically distinct window (outage).
 *
 * Protocol:
 *   1. For each model, create a dedicated ingest pipeline and a knn_vector
 *      field (`embedding_minilm`, `embedding_distilbert`, `embedding_mpnet`)
 *      in a shared `exp34_events` index.
 *   2. Bulk-index 2k operational signals through each pipeline in sequence
 *      (three ingest passes over the same documents).
 *   3. For each model, run 4 knn probe queries (one per window) and record
 *      recall@10 and mean top-1 score.
 *   4. Evaluate H1-H4, save results, clean up.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp34
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { generateOperationalBatch } from "./generators/operational.js";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Each model gets its own index to avoid overwriting embeddings across passes
const INDEX_PREFIX = "exp34";
const CORPUS_SIZE  = 2_000;
const BULK_CHUNK   = 200;   // smaller chunks — three embeddings per doc is heavier
const KNN_K        = 10;

type WindowName = "normal" | "degraded" | "outage" | "recovery";
const WINDOWS: WindowName[] = ["normal", "degraded", "outage", "recovery"];

const WINDOW_TEXT: Record<WindowName, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

const PROBE_QUERIES: Record<WindowName, string> = {
  normal:   "steady state metrics no anomalies background monitoring normal operations",
  degraded: "latency rising above threshold metrics anomalous degraded performance warning",
  outage:   "critical outage high latency p95 severely elevated incident active service down",
  recovery: "service recovering metrics returning to normal incident resolving stabilising",
};

interface ModelConfig {
  id: string;
  name: string;
  dim: number;
  field: string;
  pipeline: string;
  index: string;
}

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Discover deployed models
// ---------------------------------------------------------------------------

async function discoverModels(client: OSClient): Promise<ModelConfig[]> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20, _source: ["name", "model_config"] },
  });
  const body = response.body as { hits: { hits: Array<{ _id: string; _source: { name: string; model_config: { embedding_dimension: number } } }> } };

  const configs: ModelConfig[] = [];
  for (const hit of body.hits.hits) {
    if (/_\d+$/.test(hit._id)) continue; // skip shard sub-models
    const dim = hit._source.model_config?.embedding_dimension;
    const name = hit._source.name ?? "";
    if (!dim || dim === 0) continue;

    let field: string;
    let pipeline: string;
    let index: string;
    if (name.includes("all-MiniLM")) {
      field = "embedding_minilm"; pipeline = "exp34-minilm"; index = "exp34_minilm";
    } else if (name.includes("msmarco-distilbert")) {
      field = "embedding_distilbert"; pipeline = "exp34-distilbert"; index = "exp34_distilbert";
    } else if (name.includes("all-mpnet")) {
      field = "embedding_mpnet"; pipeline = "exp34-mpnet"; index = "exp34_mpnet";
    } else {
      continue; // skip unknown
    }

    configs.push({ id: hit._id, name, dim, field, pipeline, index });
  }
  return configs.sort((a, b) => a.dim - b.dim);
}

// ---------------------------------------------------------------------------
// Embed a single text via ML node
// ---------------------------------------------------------------------------

async function embedText(client: OSClient, modelId: string, text: string, dim: number): Promise<number[]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: { text_docs: [text], return_number: true, target_response: ["sentence_embedding"] },
  });
  const body = response.body as { inference_results: Array<{ output: Array<{ name: string; data: number[] }> }> };
  const output = body.inference_results[0]?.output.find((o) => o.name === "sentence_embedding");
  if (!output || output.data.length !== dim) throw new Error(`Model ${modelId}: unexpected dim ${output?.data.length}`);
  return output.data;
}

// ---------------------------------------------------------------------------
// Provision index with knn_vector fields for all three models
// ---------------------------------------------------------------------------

async function provisionIndex(client: OSClient, models: ModelConfig[]): Promise<void> {
  // Generate corpus once — reused across all three model indices
  const base = new Date("2026-05-14T10:00:00Z");
  const WINDOWS_SET = new Set(WINDOWS);
  const allSignals = [
    ...generateOperationalBatch("normal",   Math.round(CORPUS_SIZE * 0.20), base),
    ...generateOperationalBatch("degraded", Math.round(CORPUS_SIZE * 0.30), new Date(base.getTime() + 2 * 3_600_000)),
    ...generateOperationalBatch("outage",   Math.round(CORPUS_SIZE * 0.25), new Date(base.getTime() + 5 * 3_600_000)),
    ...generateOperationalBatch("recovery", CORPUS_SIZE - Math.round(CORPUS_SIZE * 0.75), new Date(base.getTime() + 7 * 3_600_000)),
  ];

  // Each model gets its own index and pipeline — no field collision
  for (const m of models) {
    process.stdout.write(`  Provisioning ${m.name.split("/").pop()} (${m.dim}-dim) → ${m.index}...\n`);

    await client.ingest.putPipeline({
      id: m.pipeline,
      body: {
        description: `exp34 — embed summary via ${m.name}`,
        processors: [{ text_embedding: { model_id: m.id, field_map: { summary: m.field } } }],
      },
    } as Parameters<typeof client.ingest.putPipeline>[0]);

    await client.indices.delete({ index: m.index }).catch(() => undefined);
    await client.indices.create({
      index: m.index,
      body: {
        settings: { index: { knn: true, number_of_shards: 2, number_of_replicas: 0, default_pipeline: m.pipeline, "knn.algo_param.ef_search": 256 } },
        mappings: {
          properties: {
            event_id:  { type: "keyword" },
            timestamp: { type: "date" },
            summary:   { type: "text" },
            tags:      { type: "keyword" },
            severity:  { type: "float" },
            [m.field]: { type: "knn_vector", dimension: m.dim, method: { name: "hnsw", engine: "faiss", space_type: "innerproduct", parameters: { m: 16, ef_construction: 256 } } },
          },
        },
      },
    } as Parameters<typeof client.indices.create>[0]);

    let indexed = 0;
    for (let offset = 0; offset < allSignals.length; offset += BULK_CHUNK) {
      const chunk = allSignals.slice(offset, offset + BULK_CHUNK);
      const body: Record<string, unknown>[] = [];
      for (const signal of chunk) {
        const window = signal.tags.find((t) => WINDOWS_SET.has(t as WindowName)) ?? "normal";
        body.push({ index: { _index: m.index, _id: signal.eventId } });
        body.push({
          event_id:  signal.eventId,
          timestamp: signal.timestamp,
          summary:   `${WINDOW_TEXT[window as WindowName]}. service=${signal.payload.affectedServices[0] ?? "unknown"}`,
          tags:      signal.tags,
          severity:  signal.importanceScore,
        });
      }
      await client.bulk({ body });
      indexed += chunk.length;
      process.stdout.write(`\r    ${indexed}/${allSignals.length}...`);
    }
    process.stdout.write("\n");
    await client.indices.refresh({ index: m.index });
  }
  console.log("  Provisioning complete.");
}

// ---------------------------------------------------------------------------
// Probe recall@10 and mean top-1 score for one model
// ---------------------------------------------------------------------------

async function probeModel(
  client: OSClient,
  model: ModelConfig,
): Promise<{ recall: Record<WindowName, number>; meanScore: number; perWindowScore: Record<WindowName, number> }> {
  const recall: Partial<Record<WindowName, number>> = {};
  const scores: Partial<Record<WindowName, number>> = {};

  for (const window of WINDOWS) {
    const vec = await embedText(client, model.id, PROBE_QUERIES[window], model.dim);
    const resp = await client.search({
      index: model.index,
      body: {
        size: KNN_K,
        query: { knn: { [model.field]: { vector: vec, k: KNN_K * 4 } } },
        _source: ["tags", "severity"],
      },
    });
    const hits = (((resp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)["hits"] as Array<Record<string, unknown>>) ?? [];
    const correct = hits.filter((h) => ((h["_source"] as Record<string, unknown>)["tags"] as string[])?.includes(window)).length;
    const top1Score = (hits[0]?.["_score"] as number) ?? 0;
    recall[window] = correct;
    scores[window] = top1Score;
  }

  const perWindowScore = scores as Record<WindowName, number>;
  const meanScore = WINDOWS.reduce((s, w) => s + (perWindowScore[w] ?? 0), 0) / WINDOWS.length;
  return { recall: recall as Record<WindowName, number>, meanScore, perWindowScore };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 34: Multi-Model Embedding Quality Comparison ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const models = await discoverModels(client);

  console.log("Deployed models:");
  for (const m of models) console.log(`  ${m.id}  dim=${m.dim}  ${m.name}`);
  if (models.length < 3) throw new Error(`Expected 3 deployed models, found ${models.length}`);

  // Check if all model indices exist and are populated
  const firstModel = models[0]!;
  const countResp = await client.count({ index: firstModel.index }).catch(() => null);
  const docCount  = countResp ? (countResp.body as { count: number }).count : 0;
  if (docCount < 500) {
    console.log(`\nProvisioning ${CORPUS_SIZE.toLocaleString()} signals per model (${models.length} indices)...`);
    await provisionIndex(client, models);
  } else {
    console.log(`\nUsing existing indices (${docCount.toLocaleString()} docs in ${firstModel.index})`);
  }

  // ---------------------------------------------------------------------------
  // Probe each model
  // ---------------------------------------------------------------------------
  console.log("\nProbing recall@10 and top-1 score per model...");

  interface ModelResult {
    model: ModelConfig;
    recall: Record<WindowName, number>;
    meanScore: number;
    perWindowScore: Record<WindowName, number>;
  }

  const results: ModelResult[] = [];
  for (const model of models) {
    process.stdout.write(`  ${model.name.split("/").pop()?.padEnd(35)} `);
    const r = await probeModel(client, model);
    results.push({ model, ...r });
    const recallStr = WINDOWS.map((w) => `${w}=${r.recall[w]}/${KNN_K}`).join("  ");
    process.stdout.write(`recall: ${recallStr}  meanScore=${r.meanScore.toFixed(4)}\n`);
  }

  // ---------------------------------------------------------------------------
  // Hypothesis evaluation
  // ---------------------------------------------------------------------------

  const minilm     = results.find((r) => r.model.name.includes("MiniLM"))!;
  const distilbert = results.find((r) => r.model.name.includes("distilbert"))!;
  const mpnet      = results.find((r) => r.model.name.includes("mpnet"))!;

  // H1: all models ≥9/10 for every window
  const h1Pass = results.every((r) => WINDOWS.every((w) => (r.recall[w] ?? 0) >= 9));
  console.log(`\nH1 — all models ≥9/${KNN_K} recall all windows: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  for (const r of results) {
    const fails = WINDOWS.filter((w) => (r.recall[w] ?? 0) < 9);
    if (fails.length) console.log(`  ${r.model.name.split("/").pop()}: FAIL on ${fails.join(",")}`);
  }

  // H2: mpnet recall ≥ minilm for every window
  const h2Pass = mpnet && minilm && WINDOWS.every((w) => (mpnet.recall[w] ?? 0) >= (minilm.recall[w] ?? 0));
  console.log(`H2 — all-mpnet recall ≥ MiniLM every window: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  for (const w of WINDOWS) {
    console.log(`  ${w}: mpnet=${mpnet?.recall[w]}  minilm=${minilm?.recall[w]}`);
  }

  // H3: mpnet mean top-1 score within 5% of minilm (both use innerproduct on normalized vecs)
  const h3Pass = mpnet && minilm && mpnet.meanScore >= minilm.meanScore * 0.95;
  console.log(`H3 — all-mpnet mean top-1 score (${mpnet?.meanScore.toFixed(4)}) within 5% of MiniLM (${minilm?.meanScore.toFixed(4)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: distilbert outage recall ≥ minilm outage recall
  const h4Pass = distilbert && minilm && (distilbert.recall["outage"] ?? 0) >= (minilm.recall["outage"] ?? 0);
  console.log(`H4 — distilbert outage recall (${distilbert?.recall["outage"]}) ≥ MiniLM (${minilm?.recall["outage"]}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  console.log("\nFull comparison table:");
  console.log("  Model".padEnd(38) + "dim  " + WINDOWS.map((w) => w.padEnd(10)).join("") + "meanScore");
  for (const r of results) {
    const shortName = r.model.name.split("/").pop()!.padEnd(35);
    const recallCols = WINDOWS.map((w) => String(r.recall[w]).padEnd(10)).join("");
    console.log(`  ${shortName} ${r.model.dim}  ${recallCols}${r.meanScore.toFixed(4)}`);
  }

  saveResults(
    "exp34",
    [
      `H1 all models ≥9/${KNN_K} recall: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 mpnet recall ≥ MiniLM all windows: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 mpnet meanScore=${mpnet?.meanScore.toFixed(4)} within 5% of MiniLM=${minilm?.meanScore.toFixed(4)}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 distilbert outage=${distilbert?.recall["outage"]} ≥ MiniLM=${minilm?.recall["outage"]}: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      models: results.map((r) => ({
        name: r.model.name,
        id: r.model.id,
        dim: r.model.dim,
        recall: r.recall,
        meanScore: r.meanScore,
        perWindowScore: r.perWindowScore,
      })),
    },
  );
  console.log("\nResults saved.");

  // Cleanup
  console.log("Cleaning up...");
  for (const m of models) {
    await client.indices.delete({ index: m.index }).catch(() => undefined);
    await client.ingest.deletePipeline({ id: m.pipeline }).catch(() => undefined);
  }
  console.log("  Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
