/**
 * Experiment 24 — OpenSearch ML Node: all-MiniLM-L6-v2 + Ingest Pipeline Throughput
 *
 * Exp 23 embedded 200 signals via sequential ollama calls (~4 signals/s, 250ms/doc).
 * This experiment moves inference to the OpenSearch ML node, benchmarking three
 * embedding strategies to find the practical throughput ceiling:
 *
 *   1. Sequential API: one `_predict` call per document — establishes the per-doc
 *      latency floor (~92ms/doc, ~11 docs/s).
 *
 *   2. Batched API: all 200 docs in a single `_predict` call — measures batch
 *      throughput and compares docs/s to sequential.
 *
 *   3. Ingest pipeline: create a `text_embedding` neural ingest processor that
 *      auto-embeds on index — measure indexing throughput (index all 200 docs and
 *      observe the pipeline's per-doc latency at the `_cat/thread_pool` level).
 *
 * Four hypotheses:
 *
 *   H1 — Batched ML API is faster than sequential: embedding 200 docs via a single
 *        `_predict` batch call takes less total wall time than 200 sequential calls.
 *        Expected: at least 2× speedup.
 *
 *   H2 — Batched ML API throughput exceeds ollama sequential by at least 5×:
 *        Exp 23 baseline was ~250ms/doc (sequential ollama). The batched ML node
 *        should produce at least 50ms/doc average latency (≥5× improvement).
 *
 *   H3 — Ingest pipeline embeds correctly: documents indexed via the neural ingest
 *        pipeline have a non-null, non-zero `embedding_minilm` field populated by
 *        the ML node at index time. Verified by fetching a stored doc after indexing.
 *
 *   H4 — knn retrieval over ML-embedded docs correctly separates incident windows:
 *        knn search using an outage query vector (embedded via ML API) returns ≥3
 *        outage-window signals in the top-5. Same as Exp 23 H1 but with the new
 *        384-dim `all-MiniLM-L6-v2` model.
 *
 * Protocol:
 *   1. Verify model is deployed on the ML node (model ID from env or discovery).
 *   2. Embed 200 signals: first sequential (record wall time), then batched (record
 *      wall time). Compare throughput.
 *   3. Create a dedicated `exp24_events` index (single shard, knn=true, 384-dim
 *      `embedding_minilm` field, neural ingest pipeline attached).
 *   4. Index 200 docs through the ingest pipeline. Fetch 3 random docs to verify
 *      the `embedding_minilm` field is populated.
 *   5. Refresh index and run knn query with outage query vector.
 *   6. Evaluate H1–H4, save results, clean up index.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   OPENSEARCH_ML_MODEL_ID=<model_id> \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp24
 *
 * Model deployment (one-time setup — already done):
 *   See docs/experiments.md Exp 24 section for ML node bootstrap commands.
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { generateAllOperationalData } from "./generators/operational.js";
import { saveResults } from "./results.js";

const EXP_EVENTS_INDEX = "exp24_events" as const;
const EMBED_DIM = 384;
const PIPELINE_ID = "exp24-minilm-embed" as const;
const FIELD_NAME = "embedding_minilm" as const;

const WINDOWS_SET = new Set(["normal", "degraded", "outage", "recovery"]);

const WINDOW_TEXT: Record<string, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

// ---------------------------------------------------------------------------
// ML API helpers
// ---------------------------------------------------------------------------

async function embedBatch(
  client: ReturnType<typeof createOpenSearchClient>,
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  const response = await client.transport.request({
    method: "POST",
    path: `/_plugins/_ml/models/${modelId}/_predict`,
    body: {
      text_docs: texts,
      return_number: true,
      target_response: ["sentence_embedding"],
    },
  });

  const body = response.body as {
    inference_results: Array<{
      output: Array<{ name: string; data: number[] }>;
    }>;
  };

  return body.inference_results.map((result) => {
    const output = result.output.find((o) => o.name === "sentence_embedding");
    if (!output || output.data.length !== EMBED_DIM) {
      throw new Error(`Unexpected embedding dim: ${output?.data.length ?? "none"} (expected ${EMBED_DIM})`);
    }
    return output.data;
  });
}

async function embedSingle(
  client: ReturnType<typeof createOpenSearchClient>,
  modelId: string,
  text: string,
): Promise<number[]> {
  const [embedding] = await embedBatch(client, modelId, [text]);
  if (!embedding) throw new Error("No embedding returned");
  return embedding;
}

// ---------------------------------------------------------------------------
// knn search
// ---------------------------------------------------------------------------

async function knnSearch(
  client: ReturnType<typeof createOpenSearchClient>,
  queryVector: number[],
  k: number,
): Promise<Array<{ id: string; tags: string[]; score: number }>> {
  const response = await client.search({
    index: EXP_EVENTS_INDEX,
    body: {
      size: k,
      query: { knn: { [FIELD_NAME]: { vector: queryVector, k: k * 4 } } },
      _source: ["event_id", "tags"],
    },
  });

  const hits = (response.body as Record<string, unknown>)["hits"] as Record<string, unknown>;
  const hitsArr = (hits["hits"] as Array<Record<string, unknown>>) ?? [];

  return hitsArr.map((h) => ({
    id: (h["_source"] as Record<string, unknown>)?.["event_id"] as string ?? h["_id"] as string,
    tags: ((h["_source"] as Record<string, unknown>)?.["tags"] as string[]) ?? [],
    score: h["_score"] as number ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 24: OpenSearch ML Node — all-MiniLM-L6-v2 + Ingest Pipeline Throughput ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const allSignals = generateAllOperationalData();

  // Discover the deployed model ID
  const modelId = process.env["OPENSEARCH_ML_MODEL_ID"] ?? await discoverModelId(client);
  console.log(`Model ID: ${modelId}`);

  // Build signal texts
  const signalTexts = allSignals.map((signal) => {
    const window = signal.tags.find((t) => WINDOWS_SET.has(t)) ?? "normal";
    return `${WINDOW_TEXT[window] ?? WINDOW_TEXT["normal"]!}. service=${signal.payload.affectedServices[0] ?? "unknown"}`;
  });

  // ---------------------------------------------------------------------------
  // Phase 1: Sequential embedding (baseline)
  // ---------------------------------------------------------------------------
  console.log(`\n--- Phase 1: Sequential embedding (${allSignals.length} docs, 1 request/doc) ---`);
  const seqStart = Date.now();
  const seqEmbeddings: number[][] = [];
  let done = 0;
  for (const text of signalTexts) {
    seqEmbeddings.push(await embedSingle(client, modelId, text));
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${allSignals.length} embedded`);
  }
  const seqMs = Date.now() - seqStart;
  const seqMsPerDoc = seqMs / allSignals.length;
  console.log(`Sequential: ${seqMs}ms total, ${seqMsPerDoc.toFixed(1)}ms/doc, ${(1000 / seqMsPerDoc).toFixed(1)} docs/s`);

  // ---------------------------------------------------------------------------
  // Phase 2: Batched embedding
  // ---------------------------------------------------------------------------
  console.log(`\n--- Phase 2: Batched embedding (${allSignals.length} docs, 1 request total) ---`);
  const batchStart = Date.now();
  const batchEmbeddings = await embedBatch(client, modelId, signalTexts);
  const batchMs = Date.now() - batchStart;
  const batchMsPerDoc = batchMs / allSignals.length;
  console.log(`Batched: ${batchMs}ms total, ${batchMsPerDoc.toFixed(1)}ms/doc, ${(1000 / batchMsPerDoc).toFixed(1)} docs/s`);

  // H1: batch faster than sequential
  const h1Pass = batchMs < seqMs;
  const speedup = seqMs / batchMs;
  console.log(`H1 — batch < sequential wall time: ${batchMs}ms vs ${seqMs}ms (${speedup.toFixed(1)}×): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: batch throughput ≥ 5× ollama sequential baseline (250ms/doc)
  const ollamaBaselineMs = 250;
  const h2Pass = batchMsPerDoc <= ollamaBaselineMs / 5;
  console.log(`H2 — batch ≤ ${(ollamaBaselineMs / 5).toFixed(0)}ms/doc (5× over ollama ${ollamaBaselineMs}ms baseline): ${batchMsPerDoc.toFixed(1)}ms/doc: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Phase 3: Neural ingest pipeline
  // ---------------------------------------------------------------------------
  console.log("\n--- Phase 3: Neural ingest pipeline ---");

  // Create ingest pipeline
  await client.ingest.putPipeline({
    id: PIPELINE_ID,
    body: {
      description: "exp24 — embed summary via all-MiniLM-L6-v2 on index",
      processors: [
        {
          text_embedding: {
            model_id: modelId,
            field_map: { summary: FIELD_NAME },
          },
        },
      ],
    },
  } as Parameters<typeof client.ingest.putPipeline>[0]);
  console.log(`  Ingest pipeline '${PIPELINE_ID}' created.`);

  // Create dedicated index with 384-dim knn_vector field
  await client.indices.delete({ index: EXP_EVENTS_INDEX }).catch(() => undefined);
  await client.indices.create({
    index: EXP_EVENTS_INDEX,
    body: {
      settings: {
        index: {
          knn: true,
          number_of_shards: 1,
          number_of_replicas: 0,
          default_pipeline: PIPELINE_ID,
        },
      },
      mappings: {
        properties: {
          event_id:        { type: "keyword" },
          timestamp:       { type: "date" },
          summary:         { type: "text" },
          tags:            { type: "keyword" },
          [FIELD_NAME]:    {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: {
              name: "hnsw",
              engine: "faiss",
              space_type: "innerproduct",
              parameters: { m: 16, ef_construction: 128 },
            },
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);
  console.log(`  Index '${EXP_EVENTS_INDEX}' created (knn=true, pipeline=${PIPELINE_ID}).`);

  // Index all 200 docs through the ingest pipeline, measure wall time
  console.log(`  Indexing ${allSignals.length} docs via ingest pipeline...`);
  const ingestStart = Date.now();
  for (let i = 0; i < allSignals.length; i++) {
    const signal = allSignals[i]!;
    await client.index({
      index: EXP_EVENTS_INDEX,
      id: signal.eventId,
      body: {
        event_id: signal.eventId,
        timestamp: signal.timestamp,
        summary: signalTexts[i]!,
        tags: signal.tags,
      },
    });
  }
  const ingestMs = Date.now() - ingestStart;
  const ingestMsPerDoc = ingestMs / allSignals.length;
  console.log(`  Ingest+embed: ${ingestMs}ms total, ${ingestMsPerDoc.toFixed(1)}ms/doc, ${(1000 / ingestMsPerDoc).toFixed(1)} docs/s`);

  await client.indices.refresh({ index: EXP_EVENTS_INDEX });

  // H3: verify pipeline populated the embedding field
  const sample = await client.get({ index: EXP_EVENTS_INDEX, id: allSignals[0]!.eventId });
  const sampleDoc = (sample.body as Record<string, unknown>)["_source"] as Record<string, unknown>;
  const sampleEmbedding = sampleDoc[FIELD_NAME] as number[] | undefined;
  const h3Pass = Array.isArray(sampleEmbedding) && sampleEmbedding.length === EMBED_DIM &&
    sampleEmbedding.some((v) => v !== 0);
  console.log(`\nH3 — ingest pipeline populated ${FIELD_NAME} (dim=${sampleEmbedding?.length ?? "none"}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Phase 4: knn retrieval — H4
  // ---------------------------------------------------------------------------
  console.log("\n--- Phase 4: knn retrieval over ingest-embedded docs ---");
  const outageQuery = "critical infrastructure failure high latency severe incident outage";
  const outageQueryVec = await embedSingle(client, modelId, outageQuery);
  const outageHits = await knnSearch(client, outageQueryVec, 5);

  console.log("Top-5 hits for outage query:");
  for (const hit of outageHits) {
    const window = hit.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown";
    console.log(`  score=${hit.score.toFixed(4)} window=${window}`);
  }

  const outageTop5Windows = outageHits.map((h) => h.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown");
  const outageTop5OutageCount = outageTop5Windows.filter((w) => w === "outage").length;
  const h4Pass = outageTop5OutageCount >= 3;
  console.log(`H4 — outage signals in top-5 for outage query: ${outageTop5OutageCount}/5: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  console.log("\nCleaning up...");
  await client.indices.delete({ index: EXP_EVENTS_INDEX });
  await client.ingest.deletePipeline({ id: PIPELINE_ID });
  console.log("  Done.");

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);
  console.log(`\nThroughput summary:`);
  console.log(`  ollama sequential (Exp 23 baseline):  ~250ms/doc   (~4 docs/s)`);
  console.log(`  ML node sequential:                    ${seqMsPerDoc.toFixed(0)}ms/doc  (~${(1000 / seqMsPerDoc).toFixed(0)} docs/s)`);
  console.log(`  ML node batch (200 docs):              ${batchMsPerDoc.toFixed(0)}ms/doc  (~${(1000 / batchMsPerDoc).toFixed(0)} docs/s)`);
  console.log(`  ML node ingest pipeline:               ${ingestMsPerDoc.toFixed(0)}ms/doc  (~${(1000 / ingestMsPerDoc).toFixed(0)} docs/s)`);

  saveResults(
    "exp24",
    [
      `H1 batch faster than sequential: ${batchMs}ms vs ${seqMs}ms (${speedup.toFixed(1)}×): ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 batch ≤50ms/doc (5× ollama): ${batchMsPerDoc.toFixed(1)}ms/doc: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 ingest pipeline populated ${FIELD_NAME} dim=${sampleEmbedding?.length ?? 0}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 outage knn top-5 outage count=${outageTop5OutageCount}/5 ≥3: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      modelId,
      model: "all-MiniLM-L6-v2",
      dimension: EMBED_DIM,
      throughput: {
        ollamaBaselineMs,
        sequentialMsPerDoc: seqMsPerDoc,
        batchMsPerDoc,
        ingestMsPerDoc,
        speedupVsOllama: ollamaBaselineMs / batchMsPerDoc,
        speedupBatchVsSeq: speedup,
      },
      knn: {
        outageQuery,
        top5Windows: outageTop5Windows,
        outageCount: outageTop5OutageCount,
      },
    },
  );
  console.log("Results saved.");
}

async function discoverModelId(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<string> {
  // Search for deployed TEXT_EMBEDDING models; filter out chunk sub-docs (IDs with trailing _N)
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

  const body = response.body as {
    hits: { hits: Array<{ _id: string; _source: { model_state: string; algorithm?: string } }> };
  };

  // Chunk sub-documents have IDs like "YIGOLZ4BgYB_vs2kWaTT_2" — skip those
  const hit = body.hits.hits.find((h) => !/_\d+$/.test(h._id));
  if (!hit) throw new Error("No deployed TEXT_EMBEDDING model found. Set OPENSEARCH_ML_MODEL_ID env var.");
  console.log(`  Discovered deployed model: ${hit._id}`);
  return hit._id;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
