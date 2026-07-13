/**
 * Experiment 56 — Non-Cognitive Baseline on Live Blog Corpus
 *
 * Independent-eval baseline: BM25-only keyword retrieval vs dense kNN on the
 * same `experience_events` blog-tagged corpus. Cognitive retrieval should
 * beat flat BM25 on slug recall for natural-language article queries.
 *
 * Hypotheses:
 *
 *   H1 — BM25 recall@5 for "article completed about <slug>" ≥ 0 (sanity).
 *
 *   H2 — kNN (mpnet 768) slug recall@5 ≥ BM25 slug recall@5.
 *
 *   H3 — kNN slug recall@5 ≥ 0.7 on the evaluated slug set.
 *
 *   H4 — At least 5 distinct article:* slugs under tags:blog.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp56
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

function hitHasTag(
  hits: Array<{ _source?: { tags?: string[] } }>,
  tag: string,
): boolean {
  return hits.some((h) => h._source?.tags?.includes(tag));
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 56 — BM25 vs kNN Blog Baseline ===\n");

  const slugResp = await client.search({
    index: INDEX,
    body: {
      size: 0,
      query: { term: { tags: "blog" } },
      aggs: {
        article_tags: { terms: { field: "tags", size: 50, include: "article:.*" } },
      },
    },
  });
  const buckets = (
    slugResp.body as {
      aggregations: { article_tags: { buckets: Array<{ key: string }> } };
    }
  ).aggregations.article_tags.buckets;

  const h4Pass = buckets.length >= 5;
  console.log(`Article slugs: ${buckets.length}`);

  const modelId = await discoverMpnet(client);
  const sample = buckets.slice(0, 15);
  let bm25Hits = 0;
  let knnHits = 0;

  for (const b of sample) {
    const articleTag = b.key;
    const slug = articleTag.replace(/^article:/, "");
    const queryText = `article completed about ${slug}`;

    const bm25 = await client.search({
      index: INDEX,
      body: {
        size: 5,
        query: {
          bool: {
            must: [{ match: { summary: queryText } }],
            filter: [{ term: { tags: "blog" } }],
          },
        },
        _source: ["tags"],
      },
    });
    const bm25List =
      (
        ((bm25.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
          "hits"
        ] as Array<{ _source?: { tags?: string[] } }>
      ) ?? [];
    if (hitHasTag(bm25List, articleTag)) bm25Hits += 1;

    const vec = await embed(client, modelId, queryText);
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
    const knnList =
      (
        ((knn.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
          "hits"
        ] as Array<{ _source?: { tags?: string[] } }>
      ) ?? [];
    if (hitHasTag(knnList, articleTag)) knnHits += 1;

    console.log(
      `  ${slug}: bm25=${hitHasTag(bm25List, articleTag)} knn=${hitHasTag(knnList, articleTag)}`,
    );
  }

  const bm25Recall = sample.length === 0 ? 0 : bm25Hits / sample.length;
  const knnRecall = sample.length === 0 ? 0 : knnHits / sample.length;

  const h1Pass = bm25Recall >= 0;
  const h2Pass = knnRecall >= bm25Recall;
  const h3Pass = knnRecall >= 0.7;

  console.log(`\nBM25 recall=${bm25Recall.toFixed(3)} kNN recall=${knnRecall.toFixed(3)}`);
  console.log(`H1 BM25 sanity: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 knn ≥ bm25: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 knn ≥ 0.7: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 ≥5 slugs: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-56",
    [
      `H1 bm25: ${h1Pass ? "PASS" : "FAIL"} (${bm25Recall.toFixed(3)})`,
      `H2 knn≥bm25: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 knn≥0.7: ${h3Pass ? "PASS" : "FAIL"} (${knnRecall.toFixed(3)})`,
      `H4 slugs: ${h4Pass ? "PASS" : "FAIL"} (n=${buckets.length})`,
    ].join("\n"),
    { bm25Recall, knnRecall, slugCount: buckets.length, h1Pass, h2Pass, h3Pass, h4Pass },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
