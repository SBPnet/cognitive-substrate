/**
 * Experiment 50 — Real Blog Cross-Session Salience via Reinforcement
 *
 * Follow-up to Exp 45 H4 / Exp 46: run the reinforcement engine over live
 * reader-session docs in `experience_events` (tags:blog), excluding seeded
 * exp45-* sessions, and verify retrieval_priority encodes cross-session
 * salience on real traffic.
 *
 * Four hypotheses:
 *
 *   H1 — Reinforcement writes retrieval_priority > 0 to ≥1 real blog doc.
 *
 *   H2 — Articles seen in ≥2 real sessions have higher median
 *        retrieval_priority than single-session articles.
 *
 *   H3 — Pearson r(retrieval_priority, session_count) ≥ 0.5 across articles
 *        with enough data (≥3 articles).
 *
 *   H4 — importance_score is not corrupted (max abs delta ≤ 0.001).
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp50
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { saveResults } from "./results.js";

const INDEX = "experience_events";
const SEEDED_SESSION_PREFIX = "exp45-";

type OSClient = ReturnType<typeof createOpenSearchClient>;

interface ExperienceDoc {
  _id: string;
  importance_score: number;
  retrieval_priority?: number;
  retrieval_count?: number;
  session_id: string;
  tags: string[];
}

async function fetchRealBlogDocsByArticle(
  client: OSClient,
): Promise<Map<string, ExperienceDoc[]>> {
  const resp = await client.search({
    index: INDEX,
    body: {
      size: 2000,
      query: {
        bool: {
          must: [{ term: { tags: "blog" } }],
          must_not: [{ prefix: { session_id: SEEDED_SESSION_PREFIX } }],
        },
      },
      _source: [
        "importance_score",
        "retrieval_priority",
        "retrieval_count",
        "session_id",
        "tags",
      ],
    },
  });

  const hits = (
    (resp.body as Record<string, unknown>)["hits"] as {
      hits: Array<{ _id: string; _source: Omit<ExperienceDoc, "_id"> }>;
    }
  ).hits;

  const byArticle = new Map<string, ExperienceDoc[]>();
  for (const hit of hits) {
    const doc: ExperienceDoc = { _id: hit._id, ...hit._source };
    if (!doc.session_id || doc.session_id.startsWith("probe-")) continue;
    const articleTag = doc.tags?.find((t) => t.startsWith("article:"));
    if (!articleTag) continue;
    const existing = byArticle.get(articleTag) ?? [];
    existing.push(doc);
    byArticle.set(articleTag, existing);
  }
  return byArticle;
}

function sessionCountPerArticle(
  byArticle: Map<string, ExperienceDoc[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [tag, docs] of byArticle) {
    counts.set(tag, new Set(docs.map((d) => d.session_id)).size);
  }
  return counts;
}

async function runReinforcement(
  client: OSClient,
  byArticle: Map<string, ExperienceDoc[]>,
  sessionCounts: Map<string, number>,
): Promise<{ reinforced: number; reinforcedIds: string[] }> {
  const engine = new ReinforcementEngine({
    openSearch: client as never,
    priorWeight: 0.3,
    countBonus: 0.02,
  });

  const reinforcedIds: string[] = [];
  // Cap per-article docs so live corpora (hundreds of scroll events) finish
  // in a reasonable wall-clock time while still covering every article.
  const MAX_DOCS_PER_ARTICLE = 3;
  for (const [articleTag, docs] of byArticle) {
    const sessionCount = sessionCounts.get(articleTag) ?? 1;
    const usageFrequency = Math.min(sessionCount / 3, 1.0);
    const sample = docs.slice(0, MAX_DOCS_PER_ARTICLE);
    for (const doc of sample) {
      await engine.evaluate({
        memoryId: doc._id,
        memoryIndex: INDEX,
        signal: {
          importance: doc.importance_score ?? 0.1,
          usageFrequency,
          goalRelevance: 0.5,
          novelty: 0.3,
          predictionAccuracy: 0.7,
          emotionalWeight: 0.4,
          contradictionRisk: 0.1,
          policyAlignment: 0.6,
        },
      });
      reinforcedIds.push(doc._id);
    }
  }
  return { reinforced: reinforcedIds.length, reinforcedIds };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pearsonR(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  const num = xs.reduce((s, v, i) => s + (v - meanX) * (ys[i]! - meanY), 0);
  const denomX = Math.sqrt(xs.reduce((s, v) => s + (v - meanX) ** 2, 0));
  const denomY = Math.sqrt(ys.reduce((s, v) => s + (v - meanY) ** 2, 0));
  if (denomX === 0 || denomY === 0) return 0;
  return num / (denomX * denomY);
}

interface ArticleStats {
  articleTag: string;
  sessionCount: number;
  medianRetrievalPriority: number;
  medianImportanceDelta: number;
  docCount: number;
}

async function fetchPostRunStats(
  client: OSClient,
  byArticleBaseline: Map<string, ExperienceDoc[]>,
  sessionCounts: Map<string, number>,
  reinforcedIds: string[],
): Promise<ArticleStats[]> {
  const idSet = new Set(reinforcedIds);
  if (idSet.size === 0) return [];

  const resp = await client.search({
    index: INDEX,
    body: {
      size: reinforcedIds.length,
      query: { ids: { values: reinforcedIds } },
      _source: [
        "importance_score",
        "retrieval_priority",
        "retrieval_count",
        "session_id",
        "tags",
      ],
    },
  });

  const hits = (
    (resp.body as Record<string, unknown>)["hits"] as {
      hits: Array<{ _id: string; _source: Omit<ExperienceDoc, "_id"> }>;
    }
  ).hits;

  const postByArticle = new Map<string, ExperienceDoc[]>();
  for (const hit of hits) {
    const doc: ExperienceDoc = { _id: hit._id, ...hit._source };
    const articleTag = doc.tags?.find((t) => t.startsWith("article:"));
    if (!articleTag) continue;
    const existing = postByArticle.get(articleTag) ?? [];
    existing.push(doc);
    postByArticle.set(articleTag, existing);
  }

  const stats: ArticleStats[] = [];
  for (const [articleTag, postDocs] of postByArticle) {
    const baselineDocs = (byArticleBaseline.get(articleTag) ?? []).filter((d) =>
      idSet.has(d._id),
    );
    const baselineById = new Map(baselineDocs.map((d) => [d._id, d]));
    const priorities = postDocs.map((d) => d.retrieval_priority ?? 0);
    const importanceDeltas = postDocs.flatMap((d) => {
      const baseline = baselineById.get(d._id)?.importance_score ?? d.importance_score;
      if (d.importance_score == null || baseline == null) return [];
      return [Math.abs(d.importance_score - baseline)];
    });
    stats.push({
      articleTag,
      sessionCount: sessionCounts.get(articleTag) ?? 1,
      medianRetrievalPriority: median(priorities),
      medianImportanceDelta: median(importanceDeltas),
      docCount: postDocs.length,
    });
  }
  return stats;
}

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 50 — Real Blog Cross-Session Salience ===\n");

  console.log("Phase 1: Baseline snapshot (real blog docs)...");
  const byArticleBaseline = await fetchRealBlogDocsByArticle(client);
  const sessionCounts = sessionCountPerArticle(byArticleBaseline);
  const totalDocs = [...byArticleBaseline.values()].reduce((s, d) => s + d.length, 0);
  const multi = [...sessionCounts.entries()].filter(([, c]) => c >= 2);
  const single = [...sessionCounts.entries()].filter(([, c]) => c === 1);
  console.log(`  Real blog docs with article tags: ${totalDocs}`);
  console.log(`  Articles: ${byArticleBaseline.size} (multi-session=${multi.length}, single=${single.length})`);

  if (totalDocs === 0) {
    saveResults("experiment-50", "SKIP — no real blog docs", {
      totalDocs: 0,
      h1Pass: false,
      h2Pass: false,
      h3Pass: false,
      h4Pass: false,
      skipped: true,
    });
    return;
  }

  console.log("\nPhase 2: Reinforcing real blog docs...");
  const { reinforced, reinforcedIds } = await runReinforcement(
    client,
    byArticleBaseline,
    sessionCounts,
  );
  console.log(`  Reinforced ${reinforced} docs`);

  console.log("\nPhase 3: Post-run measurement...");
  const postStats = await fetchPostRunStats(
    client,
    byArticleBaseline,
    sessionCounts,
    reinforcedIds,
  );
  const multiStats = postStats.filter((s) => s.sessionCount >= 2);
  const singleStats = postStats.filter((s) => s.sessionCount === 1);

  for (const s of [...postStats]
    .sort((a, b) => b.medianRetrievalPriority - a.medianRetrievalPriority)
    .slice(0, 15)) {
    console.log(
      `  ${s.articleTag}: sessions=${s.sessionCount} rp=${s.medianRetrievalPriority.toFixed(4)} docs=${s.docCount}`,
    );
  }

  const anyRpPositive = postStats.some((s) => s.medianRetrievalPriority > 0);
  const h1Pass = anyRpPositive;

  const multiMedianRp = median(multiStats.map((s) => s.medianRetrievalPriority));
  const singleMedianRp =
    singleStats.length > 0
      ? median(singleStats.map((s) => s.medianRetrievalPriority))
      : -1;
  const h2Skipped = multiStats.length === 0 || singleStats.length === 0;
  const h2Pass = !h2Skipped && multiMedianRp > singleMedianRp;

  const r = pearsonR(
    postStats.map((s) => s.medianRetrievalPriority),
    postStats.map((s) => s.sessionCount),
  );
  const h3Skipped = postStats.length < 3;
  const h3Pass = h3Skipped ? true : r >= 0.5;

  const maxImportanceDelta = Math.max(
    ...postStats.map((s) => s.medianImportanceDelta).filter((v) => !Number.isNaN(v)),
    0,
  );
  const h4Pass = maxImportanceDelta <= 0.001;

  console.log(`\nH1 rp written: ${h1Pass ? "PASS" : "FAIL"}`);
  console.log(
    `H2 multi>single: ${h2Skipped ? "SKIP" : h2Pass ? "PASS" : "FAIL"} (multi=${multiMedianRp.toFixed(4)} single=${singleMedianRp.toFixed(4)})`,
  );
  console.log(`H3 Pearson r≥0.5: ${h3Skipped ? "SKIP" : h3Pass ? "PASS" : "FAIL"} (r=${r.toFixed(4)})`);
  console.log(`H4 importance intact: ${h4Pass ? "PASS" : "FAIL"} (maxDelta=${maxImportanceDelta.toFixed(6)})`);

  const allPass = h1Pass && (h2Skipped || h2Pass) && (h3Skipped || h3Pass) && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-50",
    [
      `H1 rp written: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 multi>single: ${h2Skipped ? "SKIP" : h2Pass ? "PASS" : "FAIL"} (multi=${multiMedianRp.toFixed(4)} single=${singleMedianRp.toFixed(4)})`,
      `H3 Pearson r: ${h3Skipped ? "SKIP" : h3Pass ? "PASS" : "FAIL"} (r=${r.toFixed(4)})`,
      `H4 importance intact: ${h4Pass ? "PASS" : "FAIL"} (maxDelta=${maxImportanceDelta.toFixed(6)})`,
    ].join("\n"),
    {
      totalDocs,
      reinforced,
      multiSessionCount: multiStats.length,
      singleSessionCount: singleStats.length,
      multiMedianRp,
      singleMedianRp,
      pearsonR: r,
      maxImportanceDelta,
      perArticle: postStats,
      h1Pass,
      h2Pass,
      h2Skipped,
      h3Pass,
      h3Skipped,
      h4Pass,
    },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
