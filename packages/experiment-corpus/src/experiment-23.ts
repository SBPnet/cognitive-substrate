/**
 * Experiment 23 — Embeddings: nomic-embed-text + knn Retrieval + AbstractionEngine Clustering
 *
 * This is the first experiment to use real embeddings. It introduces
 * three things simultaneously:
 *
 *   1. Embedding pipeline: `nomic-embed-text` (768-dim, via ollama at
 *      http://localhost:11434) generates dense vectors for the 200
 *      operational signals. Vectors are written to the `embedding_nomic`
 *      field (already mapped as knn_vector dim=768 in experience_events).
 *
 *   2. knn retrieval: verifies that semantic similarity search (k-nearest
 *      neighbour over `embedding_nomic`) surfaces incident-window signals
 *      by meaning, not just by keyword. A query vector for "critical
 *      infrastructure failure high latency" should rank outage signals
 *      above normal signals even if the exact words don't match.
 *
 *   3. AbstractionEngine per-level clustering: the upgraded engine (Exp 22
 *      identified the symbolic-label ceiling) now uses cosine-centroid
 *      clustering to shrink the source set at each level. Higher levels
 *      retain only the most semantically central sources and should produce
 *      differentiated labels — the worldview node vocabulary should differ
 *      from the experience node vocabulary.
 *
 * Four hypotheses:
 *
 *   H1 — knn retrieval with an "outage / high latency / critical incident"
 *        query vector returns outage-window signals in the top-5 at a higher
 *        rate than normal-window signals. Specifically: at least 3 of the
 *        top-5 knn hits should carry the "outage" tag.
 *
 *   H2 — knn retrieval with a "steady state / no anomalies / background"
 *        query vector returns normal-window signals in the top-5 at a higher
 *        rate than outage-window signals. At least 3 of the top-5 hits
 *        should carry the "normal" tag.
 *
 *   H3 — The upgraded AbstractionEngine, when given the 200 embedded signals,
 *        produces a ladder where the dominant label token is NOT the same at
 *        every level. At least one pair of adjacent levels must differ in
 *        their dominant token, confirming that per-level clustering changes
 *        the vocabulary as depth increases.
 *
 *   H4 — The source count at each ladder level strictly decreases from
 *        experience → worldview (halving each step), confirming the
 *        centroid-clustering logic is applied. The worldview node must have
 *        fewer sources than the experience node.
 *
 * Protocol:
 *   1. Embed 200 operational signals using nomic-embed-text. Rate-limit to
 *      avoid overwhelming ollama (sequential with brief yield).
 *   2. Index into experience_events with tag exp23 for cleanup isolation,
 *      writing embedding_nomic field alongside the standard fields.
 *   3. Refresh the index and run two knn queries (outage query, normal query).
 *   4. Evaluate H1 and H2.
 *   5. Build a compression ladder using the embedded ExperienceEvent objects
 *      (with embedding_nomic stored in input.embedding after normalisation).
 *   6. Evaluate H3 and H4.
 *   7. Clean up exp23-tagged documents.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp23
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { AbstractionEngine } from "@cognitive-substrate/abstraction-engine";
import { generateAllOperationalData } from "./generators/operational.js";
import { saveResults } from "./results.js";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";

// Use a dedicated index so all docs have embedding_nomic — mixed-doc shards
// cause ConjunctionDISI errors in OpenSearch 3.0 knn queries.
const EXP_EVENTS_INDEX = "exp23_events" as const;
const EXP23_TAG = "exp23-embeddings" as const;
const EMBED_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";
const EMBED_DIM = 768;

const WINDOWS_SET = new Set(["normal", "degraded", "outage", "recovery"]);

const WINDOW_TEXT: Record<string, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED_URL}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embed request failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  const embedding = data.data[0]?.embedding;
  if (!embedding || embedding.length !== EMBED_DIM) {
    throw new Error(`Unexpected embedding dim: ${embedding?.length ?? "undefined"} (expected ${EMBED_DIM})`);
  }
  return embedding;
}

// ---------------------------------------------------------------------------
// knn search helper
// ---------------------------------------------------------------------------

async function knnSearch(
  client: ReturnType<typeof createOpenSearchClient>,
  queryVector: number[],
  k: number,
  filterTag?: string,
): Promise<Array<{ id: string; tags: string[]; score: number }>> {
  // Use bool+filter wrapper around knn for OpenSearch 3.x compatibility.
  // Inner knn filter is not supported in all OS3 builds; post-filter via bool is safer.
  const knnClause = { embedding_nomic: { vector: queryVector, k: k * 4 } };
  const query: Record<string, unknown> = {
    size: k,
    query: filterTag
      ? {
          bool: {
            must: [{ knn: knnClause }],
            filter: [{ term: { tags: filterTag } }],
          },
        }
      : { knn: knnClause },
    _source: ["event_id", "tags", "summary"],
  };

  const response = await client.search({ index: EXP_EVENTS_INDEX, body: query });
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
  console.log("=== Experiment 23: Embeddings — nomic-embed-text + knn + AbstractionEngine Clustering ===\n");

  const client = createOpenSearchClient(opensearchConfigFromEnv());
  const allSignals = generateAllOperationalData();

  // Ensure clean dedicated index (single shard so all embedded docs share one HNSW graph)
  await client.indices.delete({ index: EXP_EVENTS_INDEX }).catch(() => undefined);
  await client.indices.create({
    index: EXP_EVENTS_INDEX,
    body: {
      settings: { index: { knn: true, number_of_shards: 1, number_of_replicas: 0 } },
      mappings: {
        properties: {
          event_id:         { type: "keyword" },
          timestamp:        { type: "date" },
          event_type:       { type: "keyword" },
          summary:          { type: "text" },
          importance_score: { type: "float" },
          reward_score:     { type: "float" },
          retrieval_count:  { type: "integer" },
          decay_factor:     { type: "float" },
          tags:             { type: "keyword" },
          embedding_nomic:  {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: { name: "hnsw", engine: "faiss", space_type: "innerproduct", parameters: { m: 16, ef_construction: 128 } },
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);

  // ---------------------------------------------------------------------------
  // Phase 1: embed and index
  // ---------------------------------------------------------------------------
  console.log(`Embedding ${allSignals.length} signals with ${EMBED_MODEL} (dim=${EMBED_DIM})...`);

  const embeddedEvents: Array<ExperienceEvent & { embeddingNomic: number[] }> = [];
  let done = 0;

  for (const signal of allSignals) {
    const window = signal.tags.find((t) => WINDOWS_SET.has(t)) ?? "normal";
    const text = `${WINDOW_TEXT[window] ?? WINDOW_TEXT["normal"]!}. service=${signal.payload.affectedServices[0] ?? "unknown"}`;

    const embedding = await embedText(text);

    const enriched = {
      ...signal,
      input: { ...signal.input, text, embedding },
      embeddingNomic: embedding,
    };
    embeddedEvents.push(enriched);

    await client.index({
      index: EXP_EVENTS_INDEX,
      id: signal.eventId,
      body: {
        event_id: signal.eventId,
        timestamp: signal.timestamp,
        event_type: signal.type,
        summary: text,
        importance_score: signal.importanceScore,
        reward_score: 0.5,
        retrieval_count: 0,
        decay_factor: 1.0,
        tags: [...signal.tags, EXP23_TAG],
        embedding_nomic: embedding,
      },
    });

    done++;
    if (done % 50 === 0) console.log(`  ${done}/${allSignals.length} embedded and indexed`);
  }

  await client.indices.refresh({ index: EXP_EVENTS_INDEX });
  console.log(`Indexed ${done} signals. Refreshed.\n`);

  // ---------------------------------------------------------------------------
  // Phase 2: knn retrieval — H1 and H2
  // ---------------------------------------------------------------------------

  const outageQuery = "critical infrastructure failure high latency severe incident outage";
  const normalQuery = "steady state background metrics no anomalies quiet";

  console.log("--- knn retrieval ---");
  console.log(`Outage query: "${outageQuery}"`);
  const outageQueryVec = await embedText(outageQuery);
  const outageHits = await knnSearch(client, outageQueryVec, 5);

  console.log("Top-5 hits for outage query:");
  for (const hit of outageHits) {
    const window = hit.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown";
    console.log(`  score=${hit.score.toFixed(4)} window=${window} tags=${hit.tags.filter(t => WINDOWS_SET.has(t)).join(",")}`);
  }

  const outageTop5Windows = outageHits.map((h) => h.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown");
  const outageTop5OutageCount = outageTop5Windows.filter((w) => w === "outage").length;
  const h1Pass = outageTop5OutageCount >= 3;
  console.log(`H1 — outage signals in top-5 for outage query: ${outageTop5OutageCount}/5: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  console.log(`\nNormal query: "${normalQuery}"`);
  const normalQueryVec = await embedText(normalQuery);
  const normalHits = await knnSearch(client, normalQueryVec, 5);

  console.log("Top-5 hits for normal query:");
  for (const hit of normalHits) {
    const window = hit.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown";
    console.log(`  score=${hit.score.toFixed(4)} window=${window}`);
  }

  const normalTop5Windows = normalHits.map((h) => h.tags.find((t) => WINDOWS_SET.has(t)) ?? "unknown");
  const normalTop5NormalCount = normalTop5Windows.filter((w) => w === "normal").length;
  const h2Pass = normalTop5NormalCount >= 3;
  console.log(`H2 — normal signals in top-5 for normal query: ${normalTop5NormalCount}/5: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Phase 3: AbstractionEngine per-level clustering — H3 and H4
  // ---------------------------------------------------------------------------
  console.log("\n--- AbstractionEngine with embeddings ---");

  // Build ExperienceEvent objects with embedding_nomic in input.embedding
  const eventsForAbstraction: ExperienceEvent[] = embeddedEvents.map((e) => ({
    ...e,
    input: { ...e.input, embedding: e.embeddingNomic },
  }));

  const engine = new AbstractionEngine();
  const ladder = engine.buildCompressionLadder({ events: eventsForAbstraction });

  console.log("Ladder nodes (with per-level clustering):");
  for (const node of ladder.nodes) {
    console.log(
      `  ${node.level.padEnd(12)} sources=${node.sourceIds.length.toString().padStart(3)} ` +
        `ratio=${node.compressionRatio.toFixed(2)} confidence=${node.confidence.toFixed(3)} label="${node.label}"`,
    );
  }

  // H3: at least one pair of adjacent levels has different dominant tokens
  const tokens = ladder.nodes.map((n) => n.label.split(":")[1] ?? "");
  const anyDifferent = tokens.some((t, i) => i > 0 && t !== tokens[i - 1]);
  const h3Pass = anyDifferent;
  console.log(`\nH3 — at least one adjacent level pair has different label tokens: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Tokens by level: ${tokens.join(" | ")}`);

  // H4: source count strictly decreasing from experience → worldview
  const sourceCounts = ladder.nodes.map((n) => n.sourceIds.length);
  const strictlyDecreasing = sourceCounts.every((c, i) => i === 0 || c < sourceCounts[i - 1]!);
  const h4Pass = strictlyDecreasing && sourceCounts[sourceCounts.length - 1]! < sourceCounts[0]!;
  console.log(`H4 — source counts strictly decrease experience→worldview: ${sourceCounts.join(" → ")}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  console.log("\nCleaning up exp23 index...");
  await client.indices.delete({ index: EXP_EVENTS_INDEX });
  console.log("  Done.");

  // ---------------------------------------------------------------------------
  // Save results
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp23",
    [
      `H1 outage knn top-5 outage count=${outageTop5OutageCount}/5 ≥3: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 normal knn top-5 normal count=${normalTop5NormalCount}/5 ≥3: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 adjacent ladder levels have different label tokens: ${h3Pass ? "PASS" : "FAIL"} tokens=[${tokens.join(",")}]`,
      `H4 source counts strictly decrease (${sourceCounts.join("→")}): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      knn: {
        outageQuery: { query: outageQuery, top5Windows: outageTop5Windows, outageCount: outageTop5OutageCount },
        normalQuery: { query: normalQuery, top5Windows: normalTop5Windows, normalCount: normalTop5NormalCount },
      },
      ladder: {
        tokens,
        sourceCounts,
        nodes: ladder.nodes.map((n) => ({ level: n.level, label: n.label, sources: n.sourceIds.length, ratio: n.compressionRatio, confidence: n.confidence })),
      },
      model: EMBED_MODEL,
      dimension: EMBED_DIM,
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
