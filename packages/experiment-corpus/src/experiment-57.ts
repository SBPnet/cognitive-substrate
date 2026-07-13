/**
 * Experiment 57 — Held-Out Blog Article Recall
 *
 * Independent-eval holdout: pick the least-frequent article:* slugs (held out
 * of any calibration sampling), never used as calibration seeds in this run,
 * and measure kNN recall@5. Certifies generalization beyond popular articles.
 *
 * Hypotheses:
 *
 *   H1 — Holdout set has ≥ 3 article slugs with doc_count ≤ median.
 *
 *   H2 — Holdout kNN recall@5 ≥ 0.6.
 *
 *   H3 — Holdout mean importance_score is finite and ≥ 0.
 *
 *   H4 — No holdout slug equals the single most-frequent (calibration) slug.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp57
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

const INDEX = "experience_events";
type OSClient = ReturnType<typeof createOpenSearchClient>;

async function discoverMpnet(client: OSClient): Promise<string> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const body = response.body as {
    hits: { hits: Array<{ _id: string; _source: { name: string } }> };
  };
  const hit = body.hits.hits.find(
    (h) => h._source.name?.includes("all-mpnet") && !/_\d+$/.test(h._id),
  );
  if (!hit) throw new Error("all-mpnet not deployed");
  return hit._id;
}

async function embed(client: OSClient, modelId: string, text: string): Promise<number[]> {
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

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 57 — Held-Out Blog Article Recall ===\n");

  const slugResp = await client.search({
    index: INDEX,
    body: {
      size: 0,
      query: { term: { tags: "blog" } },
      aggs: {
        article_tags: {
          terms: { field: "tags", size: 100, include: "article:.*", order: { _count: "asc" } },
          aggs: {
            mean_importance: { avg: { field: "importance_score" } },
          },
        },
      },
    },
  });

  const buckets = (
    slugResp.body as {
      aggregations: {
        article_tags: {
          buckets: Array<{
            key: string;
            doc_count: number;
            mean_importance: { value: number | null };
          }>;
        };
      };
    }
  ).aggregations.article_tags.buckets;

  if (buckets.length < 4) throw new Error("Need ≥4 article slugs for holdout");

  const counts = buckets.map((b) => b.doc_count).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)]!;
  const mostFrequent = [...buckets].sort((a, b) => b.doc_count - a.doc_count)[0]!;
  const holdout = buckets.filter((b) => b.doc_count <= median).slice(0, 8);

  const h1Pass = holdout.length >= 3;
  const h4Pass = holdout.every((b) => b.key !== mostFrequent.key);
  console.log(
    `Holdout n=${holdout.length} median_count=${median} top=${mostFrequent.key}`,
  );

  const modelId = await discoverMpnet(client);
  let hits = 0;
  const importances: number[] = [];

  for (const b of holdout) {
    const slug = b.key.replace(/^article:/, "");
    const vec = await embed(client, modelId, `article completed about ${slug}`);
    const knn = await client.search({
      index: INDEX,
      body: {
        size: 5,
        query: {
          bool: {
            must: [{ knn: { embedding: { vector: vec, k: 20 } } }],
            filter: [{ term: { tags: "blog" } }],
          },
        },
        _source: ["tags"],
      },
    });
    const list =
      (
        ((knn.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
          "hits"
        ] as Array<{ _source?: { tags?: string[] } }>
      ) ?? [];
    const pass = list.some((h) => h._source?.tags?.includes(b.key));
    if (pass) hits += 1;
    if (typeof b.mean_importance.value === "number") {
      importances.push(b.mean_importance.value);
    }
    console.log(`  ${pass ? "✓" : "✗"} ${slug} count=${b.doc_count}`);
  }

  const recall = holdout.length === 0 ? 0 : hits / holdout.length;
  const meanImp =
    importances.length === 0
      ? 0
      : importances.reduce((s, v) => s + v, 0) / importances.length;

  const h2Pass = recall >= 0.6;
  const h3Pass = Number.isFinite(meanImp) && meanImp >= 0;

  console.log(`\nHoldout recall=${recall.toFixed(3)} meanImp=${meanImp.toFixed(4)}`);
  console.log(`H1 holdout size: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 recall≥0.6: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 importance: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 not top slug: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-57",
    [
      `H1 holdout size: ${h1Pass ? "PASS" : "FAIL"} (n=${holdout.length})`,
      `H2 recall: ${h2Pass ? "PASS" : "FAIL"} (${recall.toFixed(3)})`,
      `H3 importance: ${h3Pass ? "PASS" : "FAIL"} (${meanImp.toFixed(4)})`,
      `H4 not calibration top: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("\n"),
    {
      holdout: holdout.map((b) => ({ tag: b.key, count: b.doc_count })),
      recall,
      meanImp,
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
