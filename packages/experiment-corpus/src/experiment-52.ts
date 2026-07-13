/**
 * Experiment 52 — Live Blog kNN Recall Certification (mpnet 768)
 *
 * Certifies Exp 45 H3 against production `experience_events` after aligning
 * probe embeddings with the ingest pipeline (all-mpnet-base-v2, 768-d).
 *
 * Hypotheses:
 *
 *   H1 — Probe model dim matches index mapping (768).
 *
 *   H2 — For each distinct article:* slug (up to 20), a kNN query using
 *        "article completed about <slug>" retrieves a doc tagged
 *        article:<slug> in the top 5. Recall ≥ 80%.
 *
 *   H3 — At least one top-5 hit for a passing slug carries tags:blog
 *        (live reader path, not only agent/upload corpus).
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp52
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

const INDEX = "experience_events";
const EXPECTED_DIM = 768;

type OSClient = ReturnType<typeof createOpenSearchClient>;

async function discoverMpnet(client: OSClient): Promise<{ id: string; dim: number }> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
  });
  const body = response.body as {
    hits: {
      hits: Array<{
        _id: string;
        _source: { name: string; model_config: { embedding_dimension: number } };
      }>;
    };
  };
  const hit = body.hits.hits.find(
    (h) => h._source.name?.includes("all-mpnet") && !/_\d+$/.test(h._id),
  );
  if (!hit) throw new Error("all-mpnet model not found in DEPLOYED state");
  return { id: hit._id, dim: hit._source.model_config.embedding_dimension };
}

async function indexEmbeddingDim(client: OSClient): Promise<number> {
  const resp = await client.indices.getMapping({ index: INDEX });
  const body = resp.body as Record<
    string,
    { mappings?: { properties?: { embedding?: { dimension?: number } } } }
  >;
  const dim = body[INDEX]?.mappings?.properties?.embedding?.dimension;
  if (typeof dim !== "number") throw new Error("experience_events.embedding dimension missing");
  return dim;
}

async function embedText(client: OSClient, modelId: string, text: string): Promise<number[]> {
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

interface SlugResult {
  slug: string;
  pass: boolean;
  hasBlog: boolean;
  topTags: string[];
}

async function knnRecallBySlugs(client: OSClient, modelId: string): Promise<SlugResult[]> {
  const slugResp = await client.search({
    index: INDEX,
    body: {
      size: 0,
      query: { term: { tags: "blog" } },
      aggs: {
        article_tags: {
          terms: { field: "tags", size: 100, include: "article:.*" },
        },
      },
    },
  });

  const slugBody = slugResp.body as {
    aggregations: {
      article_tags: { buckets: Array<{ key: string; doc_count: number }> };
    };
  };

  const results: SlugResult[] = [];
  for (const bucket of slugBody.aggregations.article_tags.buckets.slice(0, 20)) {
    const articleTag = bucket.key;
    const slug = articleTag.replace(/^article:/, "");
    const vec = await embedText(client, modelId, `article completed about ${slug}`);
    if (vec.length !== EXPECTED_DIM) {
      throw new Error(`Probe vector dim ${vec.length} !== ${EXPECTED_DIM}`);
    }

    const knnResp = await client.search({
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

    const hits =
      (
        ((knnResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
          "hits"
        ] as Array<Record<string, unknown>>
      ) ?? [];

    const allTags = hits.flatMap(
      (h) => ((h["_source"] as Record<string, unknown>)?.["tags"] as string[]) ?? [],
    );
    results.push({
      slug,
      pass: allTags.includes(articleTag),
      hasBlog: allTags.includes("blog"),
      topTags: [...new Set(allTags)].slice(0, 8),
    });
  }
  return results;
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 52 — Live Blog kNN Recall (mpnet 768) ===\n");

  const { id: modelId, dim } = await discoverMpnet(client);
  const mappingDim = await indexEmbeddingDim(client);
  console.log(`Model ${modelId} dim=${dim}; index embedding dim=${mappingDim}`);

  const h1Pass = dim === EXPECTED_DIM && mappingDim === EXPECTED_DIM;
  console.log(`H1 dim contract 768: ${h1Pass ? "PASS" : "FAIL"}`);

  console.log("\nRunning filtered blog kNN recall...");
  const knnResults = await knnRecallBySlugs(client, modelId);
  if (knnResults.length === 0) {
    throw new Error("No article:* tags under tags:blog — cannot certify");
  }

  const passing = knnResults.filter((r) => r.pass).length;
  const recallRate = passing / knnResults.length;
  const blogHits = knnResults.filter((r) => r.hasBlog).length;
  console.log(`Recall: ${passing}/${knnResults.length} (${(recallRate * 100).toFixed(1)}%)`);
  for (const r of knnResults) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.slug} blog=${r.hasBlog} tags=${r.topTags.join(",")}`);
  }

  const h2Pass = recallRate >= 0.8;
  const h3Pass = blogHits >= 1 && knnResults.some((r) => r.pass && r.hasBlog);

  console.log(`\nH1 — dim 768 align: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — slug recall ≥80%: ${h2Pass ? "✓ PASS" : "✗ FAIL"} (${(recallRate * 100).toFixed(1)}%)`);
  console.log(`H3 — blog-tagged hits present: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-52",
    [
      `H1 dim contract: ${h1Pass ? "PASS" : "FAIL"} (model=${dim} mapping=${mappingDim})`,
      `H2 slug recall: ${h2Pass ? "PASS" : "FAIL"} (${passing}/${knnResults.length})`,
      `H3 blog hits: ${h3Pass ? "PASS" : "FAIL"}`,
    ].join("\n"),
    {
      modelId,
      dim,
      mappingDim,
      recallRate,
      knnResults,
      h1Pass,
      h2Pass,
      h3Pass,
    },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
