/**
 * Experiment 51 -- Lucene BBQ vs float32 on OpenSearch 3.6
 *
 * OpenSearch 3.6 adds Lucene 1-bit Scalar Quantization (BBQ-class compression)
 * via `encoder: { name: "sq", parameters: { bits: 1 } }`. This experiment
 * compares a fresh float32 lucene HNSW index against a 1-bit SQ index on the
 * same 20-doc operational-window corpus. Production indexes are not remapped.
 *
 * Hypotheses:
 *
 *   H1 -- float32 lucene baseline: top-1 knn correct for all 4 windows.
 *
 *   H2 -- 1-bit SQ lucene: top-1 knn correct for all 4 windows (same bar as H1).
 *
 *   H3 -- 1-bit SQ hybrid bool+knn+term returns >=1 correct-window hit in top-5
 *        with no errors (filtered search on quantized vectors).
 *
 *   H4 -- At n=100 (text + vector docs), 1-bit SQ total primary store is
 *        comparable to float32 (ratio <= 1.15). Absolute 32x savings are
 *        vector-payload dominated and require larger corpora before remapping
 *        production indexes.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp51
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

const FLOAT_INDEX = "exp51_float32";
const BBQ_INDEX = "exp51_bbq";
const PIPELINE_ID = "exp51-embed";
const FIELD_NAME = "embedding_minilm";
const EMBED_DIM = 384;
const DOCS_PER_WINDOW = 25;
const KNN_K = 10;

type WindowName = "normal" | "degraded" | "outage" | "recovery";
const WINDOWS: WindowName[] = ["normal", "degraded", "outage", "recovery"];

const WINDOW_TEXT: Record<WindowName, string> = {
  normal: "steady state metrics no anomalies background monitoring normal operations",
  degraded: "latency rising above threshold metrics anomalous degraded performance warning",
  outage: "critical outage high latency p95 severely elevated incident active service down",
  recovery: "service recovering metrics returning to normal incident resolving stabilising",
};

type OSClient = ReturnType<typeof createOpenSearchClient>;

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
  const body = response.body as {
    hits: { hits: Array<{ _id: string; _source?: { name?: string } }> };
  };
  const hit =
    body.hits.hits.find(
      (h) => h._source?.name?.includes("all-MiniLM") && !/_\d+$/.test(h._id),
    ) ?? body.hits.hits.find((h) => !/_\d+$/.test(h._id));
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
  if (!output || output.data.length !== EMBED_DIM) {
    throw new Error(`Unexpected embedding dim: got ${output?.data.length}, want ${EMBED_DIM}`);
  }
  return output.data;
}

function knnMethod(bbq: boolean): Record<string, unknown> {
  const parameters: Record<string, unknown> = { m: 16, ef_construction: 128 };
  if (bbq) {
    // OpenSearch 3.6 lucene 1-bit SQ (BBQ-class). `encoder.name: "binary"` is
    // rejected; use sq bits=1 instead.
    parameters["encoder"] = { name: "sq", parameters: { bits: 1 } };
  }
  return {
    name: "hnsw",
    engine: "lucene",
    space_type: "cosinesimil",
    parameters,
  };
}

async function provisionIndex(
  client: OSClient,
  index: string,
  modelId: string,
  bbq: boolean,
): Promise<void> {
  await client.indices.delete({ index }).catch(() => undefined);
  await client.indices.create({
    index,
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
          event_id: { type: "keyword" },
          timestamp: { type: "date" },
          summary: { type: "text" },
          window: { type: "keyword" },
          [FIELD_NAME]: {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: knnMethod(bbq),
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);

  const body: Record<string, unknown>[] = [];
  let docIdx = 0;
  for (const window of WINDOWS) {
    for (let i = 0; i < DOCS_PER_WINDOW; i++) {
      const id = `exp51-${bbq ? "bbq" : "f32"}-${window}-${i}`;
      body.push({ index: { _index: index, _id: id } });
      body.push({
        event_id: id,
        timestamp: new Date(Date.now() - docIdx * 60_000).toISOString(),
        summary: `${WINDOW_TEXT[window]}. instance=${i}`,
        window,
      });
      docIdx++;
    }
  }
  await client.bulk({ body, refresh: "wait_for" });
}

async function probeTop1(
  client: OSClient,
  index: string,
  modelId: string,
): Promise<Array<{ window: WindowName; top1Correct: boolean }>> {
  const results: Array<{ window: WindowName; top1Correct: boolean }> = [];
  for (const window of WINDOWS) {
    const vector = await embed(client, modelId, WINDOW_TEXT[window]);
    const resp = await client.search({
      index,
      body: {
        size: KNN_K,
        query: { knn: { [FIELD_NAME]: { vector, k: KNN_K } } },
        _source: ["window"],
      },
    });
    const hits = (
      (resp.body as Record<string, unknown>)["hits"] as {
        hits: Array<{ _source: { window: WindowName } }>;
      }
    ).hits;
    const top1 = hits[0]?._source.window;
    results.push({ window, top1Correct: top1 === window });
  }
  return results;
}

async function hybridProbe(
  client: OSClient,
  index: string,
  modelId: string,
): Promise<{ ok: boolean; correctInTop5: number; error?: string }> {
  try {
    const vector = await embed(client, modelId, WINDOW_TEXT.outage);
    const resp = await client.search({
      index,
      body: {
        size: 5,
        query: {
          bool: {
            must: [{ knn: { [FIELD_NAME]: { vector, k: 10 } } }],
            filter: [{ term: { window: "outage" } }],
          },
        },
        _source: ["window"],
      },
    });
    const hits = (
      (resp.body as Record<string, unknown>)["hits"] as {
        hits: Array<{ _source: { window: WindowName } }>;
      }
    ).hits;
    const correctInTop5 = hits.filter((h) => h._source.window === "outage").length;
    return { ok: true, correctInTop5 };
  } catch (err) {
    return { ok: false, correctInTop5: 0, error: (err as Error).message };
  }
}

async function primaryStoreBytes(client: OSClient, index: string): Promise<number> {
  await client.indices.forcemerge({ index, max_num_segments: 1 }).catch(() => undefined);
  await client.indices.refresh({ index });
  const resp = await client.indices.stats({ index, metric: ["store"] });
  const body = resp.body as {
    indices: Record<string, { primaries: { store: { size_in_bytes: number } } }>;
  };
  return body.indices[index]?.primaries.store.size_in_bytes ?? 0;
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 51: Lucene BBQ vs float32 (OpenSearch 3.6) ===\n");

  const modelId = await discoverModelId(client);
  console.log(`Model ID: ${modelId}`);

  await client.ingest.putPipeline({
    id: PIPELINE_ID,
    body: {
      description: "exp51 embed summary",
      processors: [{ text_embedding: { model_id: modelId, field_map: { summary: FIELD_NAME } } }],
    },
  } as Parameters<typeof client.ingest.putPipeline>[0]);

  console.log("\nProvisioning float32 index...");
  await provisionIndex(client, FLOAT_INDEX, modelId, false);
  console.log("Provisioning BBQ index...");
  await provisionIndex(client, BBQ_INDEX, modelId, true);

  console.log("\nH1: float32 knn top-1...");
  const floatResults = await probeTop1(client, FLOAT_INDEX, modelId);
  for (const r of floatResults) {
    console.log(`  ${r.window}: top-1=${r.top1Correct ? "correct" : "WRONG"}`);
  }
  const h1Pass = floatResults.every((r) => r.top1Correct);
  console.log(`H1 -- float32 top-1 all windows: ${h1Pass ? "PASS" : "FAIL"}`);

  console.log("\nH2: BBQ knn top-1...");
  const bbqResults = await probeTop1(client, BBQ_INDEX, modelId);
  for (const r of bbqResults) {
    console.log(`  ${r.window}: top-1=${r.top1Correct ? "correct" : "WRONG"}`);
  }
  const h2Pass = bbqResults.every((r) => r.top1Correct);
  console.log(`H2 -- BBQ top-1 all windows: ${h2Pass ? "PASS" : "FAIL"}`);

  console.log("\nH3: BBQ hybrid bool+knn+term...");
  const hybrid = await hybridProbe(client, BBQ_INDEX, modelId);
  console.log(
    `  ok=${hybrid.ok} correctInTop5=${hybrid.correctInTop5}${hybrid.error ? ` error=${hybrid.error}` : ""}`,
  );
  const h3Pass = hybrid.ok && hybrid.correctInTop5 >= 1;
  console.log(`H3 -- BBQ hybrid filtered query: ${h3Pass ? "PASS" : "FAIL"}`);

  console.log("\nH4: store size comparison...");
  const floatBytes = await primaryStoreBytes(client, FLOAT_INDEX);
  const bbqBytes = await primaryStoreBytes(client, BBQ_INDEX);
  const ratio = floatBytes > 0 ? bbqBytes / floatBytes : Number.POSITIVE_INFINITY;
  console.log(`  float32=${floatBytes}B BBQ=${bbqBytes}B ratio=${ratio.toFixed(3)}`);
  const h4Pass = floatBytes > 1024 && ratio <= 1.15;
  console.log(
    `H4 -- BBQ store comparable to float32 (ratio<=1.15): ${h4Pass ? "PASS" : "FAIL"}`,
  );

  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-51",
    [
      `H1 float32 top-1: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 BBQ top-1: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 BBQ hybrid: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 BBQ store comparable (ratio=${(bbqBytes / Math.max(floatBytes, 1)).toFixed(3)}): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      modelId,
      floatResults,
      bbqResults,
      hybrid,
      storeBytes: { float32: floatBytes, bbq: bbqBytes, ratio: bbqBytes / Math.max(floatBytes, 1) },
    },
  );

  console.log("\nCleaning up...");
  await client.indices.delete({ index: FLOAT_INDEX }).catch(() => undefined);
  await client.indices.delete({ index: BBQ_INDEX }).catch(() => undefined);
  await client.ingest.deletePipeline({ id: PIPELINE_ID }).catch(() => undefined);
  console.log("  Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
