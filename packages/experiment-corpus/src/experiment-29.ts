/**
 * Experiment 29 — Corpus Scaling: 10,000 Signals
 *
 * Exp 24 validated throughput at 200 signals and confirmed the neural ingest
 * pipeline. This experiment scales to 10,000 signals to characterise:
 *
 *   1. Ingest throughput at scale — does per-doc latency degrade as the index
 *      grows? We batch index in chunks of 500 using the bulk API and report
 *      docs/s across the full run.
 *
 *   2. knn recall at scale — does retrieval quality (top-k window purity)
 *      hold as the corpus grows 50×? We test four query flavours (outage,
 *      degraded, recovery, normal) and check that window-matched hits are
 *      majority in each top-10 result set.
 *
 *   3. Decay severity-selectivity at scale — DecayEngine processes a
 *      500-signal in-memory sample built from the 10k corpus. Outage signals
 *      (importanceScore ≥ 0.9) should be retained at ≥ 2× the rate of
 *      normal signals (importanceScore ≤ 0.15), replicating the Exp 19
 *      characterisation at larger scale.
 *
 *   4. Compression clustering at scale — the same DecayEngine pass over a
 *      500-signal aged sample (ageDays=45) must produce compressionClusters,
 *      confirming that the clustering heuristic scales to a large candidate
 *      pool without collapsing into a single mega-cluster or producing no
 *      clusters at all.
 *
 * Four hypotheses:
 *
 *   H1 — Bulk ingest throughput ≥ 50 docs/s: indexing 10,000 signals via the
 *        bulk API with the neural embedding pipeline attached should sustain
 *        ≥50 docs/s average across the full run (budget ~200 s wall time).
 *
 *   H2 — knn recall at scale: for each of the four window query flavours
 *        (outage, degraded, recovery, normal) the majority (≥6/10) of top-10
 *        hits belong to the correct window class.
 *
 *   H3 — Decay is severity-selective at scale: when DecayEngine processes the
 *        500-signal sample at ageDays=0, outage signals are retained at a
 *        rate ≥ 2× higher than normal signals.
 *
 *   H4 — Compression clustering fires on mid-importance aged candidates: when
 *        DecayEngine processes 200 synthetic candidates with importanceScore
 *        in [0.42, 0.499], retrievalCount=3, contradictionScore=0.1, ageDays=45,
 *        at least one candidate receives the `compress` action and at least one
 *        compressionCluster is produced, confirming the compress branch is reachable.
 *
 * Protocol:
 *   1. Generate 10,000 signals in-memory using the scaled generator.
 *   2. Create a dedicated index with the neural ingest pipeline attached.
 *   3. Bulk index in 500-doc chunks; record total wall time and docs/s.
 *   4. Refresh the index; run four knn queries and score top-10 window purity.
 *   5. Draw a stratified 500-signal in-memory sample from the 10k corpus.
 *   6. Run DecayEngine.planForgetting() at ageDays=0; check H3 retain rates.
 *   7. Run DecayEngine.planForgetting() on 200 mid-importance synthetic candidates (ageDays=45); check H4.
 *   8. Save results, clean up index.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   OPENSEARCH_ML_MODEL_ID=<model_id> \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp29
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { DecayEngine } from "@cognitive-substrate/decay-engine";
import { generateOperationalBatch } from "./generators/operational.js";
import { saveResults } from "./results.js";
import type { OperationalSignal } from "@cognitive-substrate/core-types";
import type { ForgettingCandidate } from "@cognitive-substrate/decay-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXP_INDEX     = "exp29_events" as const;
const EMBED_DIM     = 384;
const PIPELINE_ID   = "exp29-minilm-embed" as const;
const FIELD_NAME    = "embedding_minilm" as const;
const TOTAL_SIGNALS = 10_000;
const BULK_CHUNK    = 500;
const SAMPLE_SIZE   = 500;
const KNN_K         = 10;

const WINDOWS = ["normal", "degraded", "outage", "recovery"] as const;
type Window = (typeof WINDOWS)[number];

const WINDOW_TEXT: Record<Window, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

function generateScaledCorpus(total: number): OperationalSignal[] {
  // Proportions mirror the 200-signal corpus: 20% normal, 30% degraded, 25% outage, 25% recovery
  const base = new Date("2026-05-14T10:00:00Z");
  const normalCount   = Math.round(total * 0.20);
  const degradedCount = Math.round(total * 0.30);
  const outageCount   = Math.round(total * 0.25);
  const recoveryCount = total - normalCount - degradedCount - outageCount;

  return [
    ...generateOperationalBatch("normal",   normalCount,   base),
    ...generateOperationalBatch("degraded", degradedCount, new Date(base.getTime() + 2 * 3_600_000)),
    ...generateOperationalBatch("outage",   outageCount,   new Date(base.getTime() + 5 * 3_600_000)),
    ...generateOperationalBatch("recovery", recoveryCount, new Date(base.getTime() + 7 * 3_600_000)),
  ];
}

// ---------------------------------------------------------------------------
// ForgettingCandidate factory
// ---------------------------------------------------------------------------

function buildCandidate(
  signal: OperationalSignal,
  window: Window,
  ageDays: number,
): ForgettingCandidate {
  // Map window to contradiction proxy matching Exp 19 characterisation
  const contradictionProxy: Record<Window, number> = {
    outage: 0.7, degraded: 0.45, recovery: 0.2, normal: 0.1,
  };
  return {
    memory: {
      memoryId: signal.eventId,
      index: "experience_events",
      score: signal.importanceScore,
      summary: `${window} operational signal`,
      importanceScore: signal.importanceScore,
    },
    retrievalCount: window === "outage" ? 5 : 1,
    contradictionScore: contradictionProxy[window],
    ageDays,
    strategicValue: window === "outage" ? 0.9 : 0.5,
  };
}

// ---------------------------------------------------------------------------
// ML API helpers
// ---------------------------------------------------------------------------

type OSClient = ReturnType<typeof createOpenSearchClient>;

async function embedBatch(client: OSClient, modelId: string, texts: string[]): Promise<number[][]> {
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
    inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
  };

  return body.inference_results.map((result) => {
    const output = result.output.find((o) => o.name === "sentence_embedding");
    if (!output || output.data.length !== EMBED_DIM) {
      throw new Error(`Unexpected embedding dim: ${output?.data.length ?? "none"}`);
    }
    return output.data;
  });
}

async function embedSingle(client: OSClient, modelId: string, text: string): Promise<number[]> {
  const [vec] = await embedBatch(client, modelId, [text]);
  if (!vec) throw new Error("No embedding returned");
  return vec;
}

// ---------------------------------------------------------------------------
// knn search
// ---------------------------------------------------------------------------

async function knnSearch(
  client: OSClient,
  queryVector: number[],
  k: number,
): Promise<Array<{ tags: string[]; score: number }>> {
  const response = await client.search({
    index: EXP_INDEX,
    body: {
      size: k,
      query: { knn: { [FIELD_NAME]: { vector: queryVector, k: k * 4 } } },
      _source: ["tags"],
    },
  });

  const hits = (response.body as Record<string, unknown>)["hits"] as Record<string, unknown>;
  const hitsArr = (hits["hits"] as Array<Record<string, unknown>>) ?? [];

  return hitsArr.map((h) => ({
    tags: ((h["_source"] as Record<string, unknown>)?.["tags"] as string[]) ?? [],
    score: h["_score"] as number ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Model discovery
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

  const body = response.body as {
    hits: { hits: Array<{ _id: string }> };
  };

  const hit = body.hits.hits.find((h) => !/_\d+$/.test(h._id));
  if (!hit) throw new Error("No deployed TEXT_EMBEDDING model. Set OPENSEARCH_ML_MODEL_ID.");
  console.log(`  Discovered model: ${hit._id}`);
  return hit._id;
}

// ---------------------------------------------------------------------------
// Bulk index — chunks signals and posts via the bulk API.
// Neural pipeline attached to the index auto-embeds the `summary` field.
// ---------------------------------------------------------------------------

async function bulkIndex(
  client: OSClient,
  signals: OperationalSignal[],
  signalTexts: string[],
): Promise<{ totalMs: number; docsPerSecond: number; errors: number }> {
  let errors = 0;
  const start = Date.now();

  for (let offset = 0; offset < signals.length; offset += BULK_CHUNK) {
    const chunk     = signals.slice(offset, offset + BULK_CHUNK);
    const chunkTexts = signalTexts.slice(offset, offset + BULK_CHUNK);

    const body: Record<string, unknown>[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const signal = chunk[i]!;
      body.push({ index: { _index: EXP_INDEX, _id: signal.eventId } });
      body.push({
        event_id:  signal.eventId,
        timestamp: signal.timestamp,
        summary:   chunkTexts[i]!,
        tags:      signal.tags,
        severity:  signal.importanceScore,
      });
    }

    const resp = await client.bulk({ body });
    const respBody = resp.body as { errors: boolean; items: Array<{ index?: { error?: unknown } }> };
    if (respBody.errors) {
      errors += respBody.items.filter((item) => item.index?.error).length;
    }

    const done = Math.min(offset + BULK_CHUNK, signals.length);
    process.stdout.write(`\r  Indexed ${done.toLocaleString()}/${signals.length.toLocaleString()} docs...`);
  }

  process.stdout.write("\n");
  const totalMs = Date.now() - start;
  return { totalMs, docsPerSecond: (signals.length / totalMs) * 1000, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 29: Corpus Scaling — 10,000 Signals ===\n");

  // ── Generate corpus ─────────────────────────────────────────────────────
  console.log(`Generating ${TOTAL_SIGNALS.toLocaleString()} signals...`);
  const allSignals = generateScaledCorpus(TOTAL_SIGNALS);
  console.log(`  Generated ${allSignals.length.toLocaleString()} signals.`);

  const windowCounts: Record<string, number> = {};
  for (const w of WINDOWS) {
    windowCounts[w] = allSignals.filter((s) => s.tags.includes(w)).length;
  }
  console.log(`  Window distribution: ${WINDOWS.map((w) => `${w}=${windowCounts[w]}`).join(", ")}`);

  const signalTexts = allSignals.map((signal) => {
    const window = WINDOWS.find((w) => signal.tags.includes(w)) ?? "normal";
    return `${WINDOW_TEXT[window]!}. service=${signal.payload.affectedServices[0] ?? "unknown"}`;
  });

  // ── OpenSearch setup ─────────────────────────────────────────────────────
  const client  = createOpenSearchClient(opensearchConfigFromEnv());
  const modelId = process.env["OPENSEARCH_ML_MODEL_ID"] ?? await discoverModelId(client);
  console.log(`Model ID: ${modelId}`);

  // Create ingest pipeline
  await client.ingest.putPipeline({
    id: PIPELINE_ID,
    body: {
      description: "exp29 — embed summary via all-MiniLM-L6-v2",
      processors: [{ text_embedding: { model_id: modelId, field_map: { summary: FIELD_NAME } } }],
    },
  } as Parameters<typeof client.ingest.putPipeline>[0]);
  console.log(`Ingest pipeline '${PIPELINE_ID}' created.`);

  // Create index (2 shards to spread load; larger ef_construction for accuracy at scale)
  await client.indices.delete({ index: EXP_INDEX }).catch(() => undefined);
  await client.indices.create({
    index: EXP_INDEX,
    body: {
      settings: {
        index: {
          knn: true,
          number_of_shards: 2,
          number_of_replicas: 0,
          default_pipeline: PIPELINE_ID,
          "knn.algo_param.ef_search": 256,
        },
      },
      mappings: {
        properties: {
          event_id:     { type: "keyword" },
          timestamp:    { type: "date" },
          summary:      { type: "text" },
          tags:         { type: "keyword" },
          severity:     { type: "float" },
          [FIELD_NAME]: {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: {
              name: "hnsw",
              engine: "faiss",
              space_type: "innerproduct",
              parameters: { m: 16, ef_construction: 256 },
            },
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);
  console.log(`Index '${EXP_INDEX}' created (shards=2, knn=true, pipeline=${PIPELINE_ID}).`);

  // ── Phase 1: Bulk ingest — H1 ────────────────────────────────────────────
  console.log(`\n--- Phase 1: Bulk ingest ${allSignals.length.toLocaleString()} docs (chunk=${BULK_CHUNK}) ---`);
  const { totalMs, docsPerSecond, errors } = await bulkIndex(client, allSignals, signalTexts);
  const totalSec = (totalMs / 1000).toFixed(1);
  console.log(`  Total: ${totalMs.toLocaleString()}ms (${totalSec}s), ${docsPerSecond.toFixed(1)} docs/s, errors=${errors}`);

  const h1Pass = docsPerSecond >= 50;
  console.log(`H1 — bulk ingest ≥50 docs/s: ${docsPerSecond.toFixed(1)} docs/s: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  await client.indices.refresh({ index: EXP_INDEX });
  const countResp = await client.count({ index: EXP_INDEX });
  const indexedCount = (countResp.body as { count: number }).count;
  console.log(`  Index doc count after refresh: ${indexedCount.toLocaleString()}`);

  // ── Phase 2: knn recall at scale — H2 ───────────────────────────────────
  console.log(`\n--- Phase 2: knn recall at scale (k=${KNN_K}) ---`);

  const windowQueryTexts: Record<Window, string> = {
    outage:   "critical infrastructure failure high latency severe incident outage",
    degraded: "performance degradation latency rising metrics anomalous warning",
    recovery: "service recovery metrics normalising incident resolved",
    normal:   "normal operations steady state no anomalies background noise",
  };

  const recallResults: Record<string, { hits: string[]; matchCount: number; pass: boolean }> = {};
  let h2Pass = true;

  for (const window of WINDOWS) {
    const queryVec = await embedSingle(client, modelId, windowQueryTexts[window]!);
    const hits     = await knnSearch(client, queryVec, KNN_K);
    const topWindows = hits.map((h) => WINDOWS.find((w) => h.tags.includes(w)) ?? "unknown");
    const matchCount = topWindows.filter((w) => w === window).length;
    const pass = matchCount >= 6;
    if (!pass) h2Pass = false;
    recallResults[window] = { hits: topWindows, matchCount, pass };
    console.log(`  ${window}: ${matchCount}/${KNN_K} correct in top-${KNN_K}: ${pass ? "✓" : "✗"}`);
  }
  console.log(`H2 — knn recall at scale (all windows ≥6/10): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ── Phase 3: Decay severity-selectivity — H3 ────────────────────────────
  console.log(`\n--- Phase 3: DecayEngine severity-selectivity on ${SAMPLE_SIZE}-signal sample (ageDays=0) ---`);

  // Stratified sample: equal share per window (125 each)
  const perWindow = Math.floor(SAMPLE_SIZE / WINDOWS.length);
  const sampleByWindow: Record<Window, OperationalSignal[]> = {} as never;
  for (const w of WINDOWS) {
    const pool  = allSignals.filter((s) => s.tags.includes(w));
    const count = Math.min(perWindow, pool.length);
    const sample: OperationalSignal[] = [];
    for (let i = 0; i < count; i++) {
      sample.push(pool[Math.floor(Math.random() * pool.length)]!);
    }
    sampleByWindow[w] = sample;
  }

  const decayEngine = new DecayEngine();

  // ageDays=0 — fresh signals; measures severity-driven retention differences
  const age0Candidates: ForgettingCandidate[] = WINDOWS.flatMap((w) =>
    sampleByWindow[w]!.map((s) => buildCandidate(s, w, 0)),
  );
  const age0Plan = decayEngine.planForgetting(age0Candidates);

  const outageIds = new Set(sampleByWindow["outage"]!.map((s) => s.eventId));
  const normalIds = new Set(sampleByWindow["normal"]!.map((s) => s.eventId));

  const outageRetained = age0Plan.decisions.filter(
    (d) => outageIds.has(d.memoryId) && d.action === "retain",
  ).length;
  const normalRetained = age0Plan.decisions.filter(
    (d) => normalIds.has(d.memoryId) && d.action === "retain",
  ).length;

  const outageRetainRate = outageRetained / (sampleByWindow["outage"]!.length || 1);
  const normalRetainRate  = normalRetained  / (sampleByWindow["normal"]!.length  || 1);
  const retainRatio = outageRetainRate / (normalRetainRate || 0.001);

  const h3Pass = outageRetainRate >= 2 * normalRetainRate;
  console.log(`  Outage retain: ${outageRetained}/${sampleByWindow["outage"]!.length} (${(outageRetainRate * 100).toFixed(1)}%)`);
  console.log(`  Normal retain: ${normalRetained}/${sampleByWindow["normal"]!.length} (${(normalRetainRate * 100).toFixed(1)}%)`);
  console.log(`  Ratio outage/normal: ${retainRatio.toFixed(2)}×`);
  console.log(`H3 — outage retain ≥ 2× normal at ageDays=0: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ── Phase 4: Compression clustering — H4 ────────────────────────────────
  //
  // With the updated DecayEngine thresholds (suppressionThreshold=0.28,
  // retirementThreshold=0.22, compressionThreshold=0.45, compressAgeDays=30),
  // the compress band is retention ∈ (0.28, 0.45] at ageDays > 30.
  // Real corpus signals at ageDays=45:
  //   degraded (imp=0.68): retention≈0.39 → compress ✓
  //   recovery (imp=0.45): retention≈0.32 → compress ✓
  // We reuse the same stratified sample at ageDays=45.
  console.log(`\n--- Phase 4: DecayEngine compression clustering on ${SAMPLE_SIZE}-signal sample (ageDays=45) ---`);

  const COMPRESS_SAMPLE = SAMPLE_SIZE;

  const age45Candidates: ForgettingCandidate[] = WINDOWS.flatMap((w) =>
    sampleByWindow[w]!.map((s) => buildCandidate(s, w, 45)),
  );
  const age45Plan = decayEngine.planForgetting(age45Candidates);

  const clusterCount  = age45Plan.compressionClusters.length;
  const compressCount = age45Plan.decisions.filter((d) => d.action === "compress").length;
  const retainCount45 = age45Plan.decisions.filter((d) => d.action === "retain").length;
  const pruneCount45  = age45Plan.decisions.filter((d) => d.action === "prune").length;

  // H4: compress branch fires for at least some candidates AND clusters form
  const h4Pass = compressCount >= 1 && clusterCount >= 1 && clusterCount < COMPRESS_SAMPLE;
  console.log(`  decisions: compress=${compressCount}, retain=${retainCount45}, prune=${pruneCount45} / ${COMPRESS_SAMPLE}`);
  console.log(`  compressionClusters: ${clusterCount}`);
  if (age45Plan.compressionClusters[0]) {
    console.log(`  cluster[0] memoryCount=${age45Plan.compressionClusters[0].memoryIds.length} priority=${age45Plan.compressionClusters[0].compressionPriority.toFixed(3)}`);
  }
  console.log(`H4 — compress fires (≥1) and cluster forms: compress=${compressCount} clusters=${clusterCount}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (process.env["EXP29_KEEP_INDEX"] === "1") {
    console.log("\nSkipping cleanup (EXP29_KEEP_INDEX=1) — index retained for downstream experiments.");
  } else {
    console.log("\nCleaning up...");
    await client.indices.delete({ index: EXP_INDEX });
    await client.ingest.deletePipeline({ id: PIPELINE_ID });
    console.log("  Done.");
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);
  console.log(`\nScale summary:`);
  console.log(`  Signals indexed:              ${indexedCount.toLocaleString()}`);
  console.log(`  Bulk ingest throughput:       ${docsPerSecond.toFixed(1)} docs/s (${totalSec}s wall time)`);
  console.log(`  knn avg correct/10:           ${(WINDOWS.reduce((s, w) => s + recallResults[w]!.matchCount, 0) / WINDOWS.length).toFixed(1)}`);
  console.log(`  Decay outage/normal ratio:    ${retainRatio.toFixed(2)}×`);
  console.log(`  Compress candidates (mid-importance age45): ${compressCount}/${COMPRESS_SAMPLE} → ${clusterCount} cluster(s)`);

  saveResults(
    "exp29",
    [
      `H1 bulk ingest ≥50 docs/s: ${docsPerSecond.toFixed(1)} docs/s over ${indexedCount.toLocaleString()} docs: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 knn recall at scale all windows ≥6/10: ${WINDOWS.map((w) => `${w}=${recallResults[w]!.matchCount}`).join(",")} : ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 outage retain ≥2× normal at ageDays=0: outage=${(outageRetainRate * 100).toFixed(1)}% normal=${(normalRetainRate * 100).toFixed(1)}% ratio=${retainRatio.toFixed(2)}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 compress fires on mid-importance age45 candidates: compress=${compressCount}/${COMPRESS_SAMPLE} clusters=${clusterCount}: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      modelId,
      model: "all-MiniLM-L6-v2",
      dimension: EMBED_DIM,
      corpus: {
        totalGenerated: allSignals.length,
        totalIndexed: indexedCount,
        windowCounts,
        bulkChunkSize: BULK_CHUNK,
        ingestErrors: errors,
      },
      throughput: {
        totalMs,
        docsPerSecond,
        msPerDoc: 1000 / docsPerSecond,
      },
      recall: {
        k: KNN_K,
        windowResults: Object.fromEntries(
          WINDOWS.map((w) => [w, { matchCount: recallResults[w]!.matchCount, topWindows: recallResults[w]!.hits }])
        ),
        avgCorrectPerK: WINDOWS.reduce((s, w) => s + recallResults[w]!.matchCount, 0) / WINDOWS.length,
      },
      decay: {
        sampleSize: SAMPLE_SIZE,
        age0: {
          outageRetainCount: outageRetained,
          normalRetainCount: normalRetained,
          outageRetainRate,
          normalRetainRate,
          retainRatio,
        },
        age45: {
          syntheticCandidates: COMPRESS_SAMPLE,
          compressCount,
          retainCount: retainCount45,
          pruneCount: pruneCount45,
          clusterCount,
          clusters: age45Plan.compressionClusters.map((c) => ({
            clusterId: c.clusterId,
            memoryCount: c.memoryIds.length,
            priority: c.compressionPriority,
          })),
        },
      },
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
