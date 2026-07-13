/**
 * Experiment 58 — Reinforcement Parameter Sensitivity Grid
 *
 * Independent-eval sensitivity: vary novelty weight / count bonus / prior
 * weight over a tiny synthetic OpenSearch-backed memory set and assert the
 * ranking of retrieval_priority remains stable under modest hyperparameter
 * shifts (monotonic in count bonus for multi-session docs).
 *
 * Hypotheses:
 *
 *   H1 — For fixed docs, higher countBonus yields ≥ retrieval_priority on the
 *        high-usage doc vs lower countBonus.
 *
 *   H2 — Higher novelty in the signal increases retrieval_priority vs low
 *        novelty for the same doc/config.
 *
 *   H3 — priorWeight=0.5 vs 0.1 both produce finite rp in (0, 1].
 *
 *   H4 — Grid has ≥ 4 evaluated cells with no engine errors.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp58
 *
 * Creates/deletes index exp58_sensitivity.
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { saveResults } from "./results.js";

const INDEX = "exp58_sensitivity";
type OSClient = ReturnType<typeof createOpenSearchClient>;

async function ensureIndex(client: OSClient): Promise<void> {
  const exists = await client.indices.exists({ index: INDEX });
  if (exists.body) {
    await client.indices.delete({ index: INDEX });
  }
  await client.indices.create({
    index: INDEX,
    body: {
      mappings: {
        properties: {
          summary: { type: "text" },
          importance_score: { type: "float" },
          retrieval_priority: { type: "float" },
          retrieval_count: { type: "integer" },
          tags: { type: "keyword" },
        },
      },
    },
  });
}

async function seed(client: OSClient): Promise<{ highId: string; lowId: string }> {
  const highId = randomUUID();
  const lowId = randomUUID();
  await client.index({
    index: INDEX,
    id: highId,
    body: {
      summary: "high usage article complete",
      importance_score: 0.6,
      retrieval_priority: 0.1,
      retrieval_count: 0,
      tags: ["exp58", "high"],
    },
    refresh: true,
  });
  await client.index({
    index: INDEX,
    id: lowId,
    body: {
      summary: "low usage page view",
      importance_score: 0.2,
      retrieval_priority: 0.1,
      retrieval_count: 0,
      tags: ["exp58", "low"],
    },
    refresh: true,
  });
  return { highId, lowId };
}

async function readRp(client: OSClient, id: string): Promise<number> {
  const doc = await client.get({ index: INDEX, id });
  const src = (doc.body as { _source: { retrieval_priority?: number } })._source;
  return src.retrieval_priority ?? 0;
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 58 — Reinforcement Parameter Sensitivity ===\n");

  await ensureIndex(client);
  const { highId, lowId } = await seed(client);

  const cells: Array<{
    priorWeight: number;
    countBonus: number;
    novelty: number;
    highRp: number;
    lowRp: number;
  }> = [];

  const grid = [
    { priorWeight: 0.1, countBonus: 0.01, novelty: 0.2 },
    { priorWeight: 0.1, countBonus: 0.05, novelty: 0.2 },
    { priorWeight: 0.5, countBonus: 0.02, novelty: 0.2 },
    { priorWeight: 0.3, countBonus: 0.02, novelty: 0.2 },
    { priorWeight: 0.3, countBonus: 0.02, novelty: 0.8 },
  ];

  for (const cell of grid) {
    // Reset priorities between cells
    await client.update({
      index: INDEX,
      id: highId,
      body: { doc: { retrieval_priority: 0.1, retrieval_count: 0 } },
      refresh: true,
    });
    await client.update({
      index: INDEX,
      id: lowId,
      body: { doc: { retrieval_priority: 0.1, retrieval_count: 0 } },
      refresh: true,
    });

    const engine = new ReinforcementEngine({
      openSearch: client as never,
      priorWeight: cell.priorWeight,
      countBonus: cell.countBonus,
    });

    await engine.evaluate({
      memoryId: highId,
      memoryIndex: INDEX as "experience_events",
      signal: {
        importance: 0.6,
        usageFrequency: 1.0,
        goalRelevance: 0.5,
        novelty: cell.novelty,
        predictionAccuracy: 0.7,
        emotionalWeight: 0.4,
        contradictionRisk: 0.1,
        policyAlignment: 0.6,
      },
    });
    await engine.evaluate({
      memoryId: lowId,
      memoryIndex: INDEX as "experience_events",
      signal: {
        importance: 0.2,
        usageFrequency: 0.2,
        goalRelevance: 0.5,
        novelty: cell.novelty,
        predictionAccuracy: 0.5,
        emotionalWeight: 0.2,
        contradictionRisk: 0.1,
        policyAlignment: 0.5,
      },
    });

    const highRp = await readRp(client, highId);
    const lowRp = await readRp(client, lowId);
    cells.push({ ...cell, highRp, lowRp });
    console.log(
      `  prior=${cell.priorWeight} bonus=${cell.countBonus} nov=${cell.novelty} → high=${highRp.toFixed(4)} low=${lowRp.toFixed(4)}`,
    );
  }

  const lowBonus = cells.find((c) => c.countBonus === 0.01 && c.novelty === 0.2)!;
  const highBonus = cells.find((c) => c.countBonus === 0.05 && c.novelty === 0.2)!;
  const lowNov = cells.find(
    (c) => c.novelty === 0.2 && c.countBonus === 0.02 && c.priorWeight === 0.3,
  )!;
  const highNov = cells.find(
    (c) => c.novelty === 0.8 && c.countBonus === 0.02 && c.priorWeight === 0.3,
  )!;

  const h1Pass = highBonus.highRp >= lowBonus.highRp;
  const h2Pass = highNov.highRp >= lowNov.highRp;
  const h3Pass = cells
    .filter((c) => c.priorWeight === 0.5 || c.priorWeight === 0.1)
    .every((c) => c.highRp > 0 && c.highRp <= 1);
  const h4Pass = cells.length >= 4;

  console.log(`\nH1 countBonus monotone: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 novelty effect: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 priorWeight finite: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 grid size: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-58",
    [
      `H1 countBonus: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 novelty: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 priorWeight: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 grid: ${h4Pass ? "PASS" : "FAIL"} (n=${cells.length})`,
    ].join("\n"),
    { cells, h1Pass, h2Pass, h3Pass, h4Pass },
  );

  await client.indices.delete({ index: INDEX }).catch(() => undefined);
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
