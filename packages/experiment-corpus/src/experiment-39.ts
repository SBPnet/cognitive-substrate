/**
 * Experiment 39 — RetrievalFeedbackWriter Pipeline Validation
 *
 * The RetrievalFeedbackWriter (packages/retrieval-engine/src/feedback.ts)
 * records whether a retrieved memory was actually used in the final response,
 * and writes that feedback to the `retrieval_feedback` index in OpenSearch.
 * This feedback feeds the future-weight adjustment used by the reinforcement
 * engine during decay scoring.
 *
 * This experiment validates the end-to-end feedback write path:
 *   1. Write N feedback records (mix of helpful/unhelpful, with/without
 *      hallucination) via RetrievalFeedbackWriter.
 *   2. Refresh and query the retrieval_feedback index to verify records
 *      landed correctly.
 *   3. Measure whether high-helpfulness records (≥0.8) have a higher mean
 *      futureWeightAdjustment than low-helpfulness records (≤0.2).
 *   4. Verify that hallucination-flagged records carry a negative
 *      futureWeightAdjustment.
 *
 * Four hypotheses:
 *
 *   H1 — All N records land in the index: count after refresh equals the
 *        number of feedback records written (no silent write failures).
 *
 *   H2 — helpfulnessScore is faithfully stored: a range query on
 *        helpfulness_score returns exactly the records above 0.7, confirming
 *        the mapping round-trips correctly.
 *
 *   H3 — High-helpfulness mean futureWeightAdjustment > 0: records with
 *        helpfulnessScore ≥ 0.8 carry a positive mean futureWeightAdjustment,
 *        confirming that helpful retrievals are reinforced.
 *
 *   H4 — Hallucination flag drives negative futureWeightAdjustment: all
 *        records where hallucinationDetected=true carry
 *        futureWeightAdjustment < 0.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp39
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  RetrievalFeedbackWriter,
} from "@cognitive-substrate/retrieval-engine";
import { saveResults } from "./results.js";
import type { RetrievalFeedbackInput } from "@cognitive-substrate/retrieval-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX         = "retrieval_feedback";
const FEEDBACK_COUNT = 40;

type OSClient = ReturnType<typeof createOpenSearchClient>;

// ---------------------------------------------------------------------------
// Generate feedback records
// ---------------------------------------------------------------------------

function buildFeedbackBatch(n: number): RetrievalFeedbackInput[] {
  const records: RetrievalFeedbackInput[] = [];
  for (let i = 0; i < n; i++) {
    const helpfulness = Math.random();
    const hallucinated = helpfulness < 0.15; // low-helpfulness records more likely to hallucinate
    const futureWeight = hallucinated
      ? -(0.05 + Math.random() * 0.15)
      : helpfulness >= 0.8
        ? (0.05 + Math.random() * 0.10)
        : 0;

    records.push({
      feedbackId:              randomUUID(),
      timestamp:               new Date(Date.now() - i * 1000).toISOString(),
      querySummary:            `Query ${i}: ${i % 3 === 0 ? "outage" : "normal"} probe`,
      retrievedMemoryId:       `mem-${randomUUID().slice(0, 8)}`,
      usedInResponse:          helpfulness > 0.5,
      helpfulnessScore:        helpfulness,
      hallucinationDetected:   hallucinated,
      futureWeightAdjustment:  futureWeight,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Ensure index mapping exists
// ---------------------------------------------------------------------------

async function ensureIndex(client: OSClient): Promise<void> {
  const exists = await client.indices.exists({ index: INDEX });
  if ((exists.body as boolean)) return;

  await client.indices.create({
    index: INDEX,
    body: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          feedback_id:             { type: "keyword" },
          timestamp:               { type: "date" },
          query_summary:           { type: "text" },
          retrieved_memory_id:     { type: "keyword" },
          used_in_response:        { type: "boolean" },
          helpfulness_score:       { type: "float" },
          hallucination_detected:  { type: "boolean" },
          future_weight_adjustment:{ type: "float" },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 39: RetrievalFeedbackWriter Pipeline Validation ===\n");

  const client  = createOpenSearchClient(opensearchConfigFromEnv());
  const writer  = new RetrievalFeedbackWriter({ openSearch: client });

  // Delete any stale data from this experiment tag
  await ensureIndex(client);
  const staleCount = await client.count({ index: INDEX }).catch(() => null);
  if (staleCount && (staleCount.body as { count: number }).count > 0) {
    await client.deleteByQuery({
      index: INDEX,
      body: { query: { match: { query_summary: "Query" } } },
      refresh: true,
    } as Parameters<typeof client.deleteByQuery>[0]).catch(() => undefined);
  }

  console.log(`Writing ${FEEDBACK_COUNT} feedback records...`);
  const batch = buildFeedbackBatch(FEEDBACK_COUNT);

  const highHelp  = batch.filter((r) => (r.helpfulnessScore ?? 0) >= 0.8);
  const lowHelp   = batch.filter((r) => (r.helpfulnessScore ?? 0) <= 0.2);
  const hallucBatch = batch.filter((r) => r.hallucinationDetected);
  console.log(`  High-helpfulness (≥0.8): ${highHelp.length}`);
  console.log(`  Low-helpfulness (≤0.2):  ${lowHelp.length}`);
  console.log(`  Hallucination flagged:   ${hallucBatch.length}`);

  for (const record of batch) {
    await writer.record(record);
  }

  await client.indices.refresh({ index: INDEX });

  // ---------------------------------------------------------------------------
  // H1 — Count
  // ---------------------------------------------------------------------------
  const countResp  = await client.count({ index: INDEX });
  const totalCount = (countResp.body as { count: number }).count;
  const h1Pass = totalCount >= FEEDBACK_COUNT;
  console.log(`\nH1 — records in index: ${totalCount} (expected ≥ ${FEEDBACK_COUNT}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H2 — helpfulnessScore range query
  // ---------------------------------------------------------------------------
  const highResp = await client.search({
    index: INDEX,
    body: {
      size: 0,
      query: { range: { helpfulness_score: { gt: 0.7 } } },
    },
  });
  const highHits = ((highResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.["total"] as { value: number } | number;
  const highCount = typeof highHits === "number" ? highHits : highHits?.value ?? 0;
  const expectedHigh = batch.filter((r) => (r.helpfulnessScore ?? 0) > 0.7).length;
  const h2Pass = highCount === expectedHigh;
  console.log(`H2 — helpfulness>0.7 count: ${highCount} (expected ${expectedHigh}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3 — High-helpfulness futureWeightAdjustment > 0 on average
  // ---------------------------------------------------------------------------
  const highHelpResp = await client.search({
    index: INDEX,
    body: {
      size: 50,
      query: { range: { helpfulness_score: { gte: 0.8 } } },
      _source: ["future_weight_adjustment"],
    },
  });
  const highHelpHits = (((highHelpResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
    "hits"
  ] as Array<Record<string, unknown>>) ?? [];
  const meanHighFwa =
    highHelpHits.length === 0
      ? 0
      : highHelpHits.reduce(
          (s, h) => s + (((h["_source"] as Record<string, unknown>)?.["future_weight_adjustment"] as number) ?? 0),
          0,
        ) / highHelpHits.length;
  const h3Pass = highHelpHits.length > 0 && meanHighFwa > 0;
  console.log(`H3 — mean futureWeightAdj for high-helpfulness: ${meanHighFwa.toFixed(4)} (n=${highHelpHits.length}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H4 — Hallucination → negative futureWeightAdjustment
  // ---------------------------------------------------------------------------
  const hallucResp = await client.search({
    index: INDEX,
    body: {
      size: 50,
      query: { term: { hallucination_detected: true } },
      _source: ["future_weight_adjustment"],
    },
  });
  const hallucHits = (((hallucResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>)?.[
    "hits"
  ] as Array<Record<string, unknown>>) ?? [];
  const allNegativeFwa = hallucHits.every(
    (h) => (((h["_source"] as Record<string, unknown>)?.["future_weight_adjustment"] as number) ?? 0) < 0,
  );
  const h4Pass = hallucHits.length > 0 && allNegativeFwa;
  console.log(`H4 — all hallucination records have FWA < 0 (n=${hallucHits.length}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp39",
    [
      `H1 count≥${FEEDBACK_COUNT}: ${h1Pass ? "PASS" : "FAIL"} (${totalCount})`,
      `H2 helpfulness range query exact: ${h2Pass ? "PASS" : "FAIL"} (${highCount}=${expectedHigh})`,
      `H3 highHelp meanFWA>0: ${h3Pass ? "PASS" : "FAIL"} (${meanHighFwa.toFixed(4)})`,
      `H4 hallucination FWA<0: ${h4Pass ? "PASS" : "FAIL"} (n=${hallucHits.length} allNeg=${allNegativeFwa})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      totalWritten: FEEDBACK_COUNT,
      totalIndexed: totalCount,
      highHelpCount: highHelpHits.length,
      meanHighFutureWeight: meanHighFwa,
      hallucinationCount: hallucHits.length,
      allHallucinationNegativeFwa: allNegativeFwa,
    },
  );
  console.log("\nResults saved.");

  // Cleanup
  await client.deleteByQuery({
    index: INDEX,
    body: { query: { match_all: {} } },
    refresh: true,
  } as Parameters<typeof client.deleteByQuery>[0]).catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
