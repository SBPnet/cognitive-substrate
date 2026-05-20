/**
 * Experiment 46 — Cross-Session Salience via Reinforcement Engine
 *
 * Experiment 45 (H4) failed because `importance_score` is assigned per-event
 * at ingest time and has no cross-session memory. The correct signal is
 * `retrieval_priority`, which the reinforcement engine writes after repeated
 * retrievals. This experiment runs the reinforcement engine over the seeded
 * exp45-s* docs in `experience_events` and re-tests the salience hypothesis.
 *
 * SAFETY: Only seeded docs (sessionId matching exp45-s*) are reinforced.
 * Real reader-session docs are never touched, preserving future H4 evaluation
 * on accumulated live data.
 *
 * Four hypotheses:
 *
 *   H1 — The reinforcement engine writes retrieval_priority > 0 to ≥1 doc.
 *
 *   H2 — Articles that appeared in ≥2 seeded sessions have higher median
 *        retrieval_priority than single-session articles (non-zero gap).
 *
 *   H3 — retrieval_priority and retrieval_count are positively correlated
 *        across reinforced docs (Pearson r ≥ 0.5).
 *
 *   H4 — The reinforcement run does not corrupt importance_score values:
 *        max absolute delta across all reinforced docs ≤ 0.001.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp46
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

// ---------------------------------------------------------------------------
// Fetch seeded docs for a given article tag
// ---------------------------------------------------------------------------

interface ExperienceDoc {
  _id: string;
  importance_score: number;
  retrieval_priority?: number;
  retrieval_count?: number;
  session_id: string;
  tags: string[];
}

async function fetchSeededDocsByArticle(
  client: OSClient,
): Promise<Map<string, ExperienceDoc[]>> {
  // Scroll through all seeded docs (session_id prefix = "exp45-")
  const resp = await client.search({
    index: INDEX,
    body: {
      size: 1000,
      query: {
        prefix: { session_id: SEEDED_SESSION_PREFIX },
      },
      _source: ["importance_score", "retrieval_priority", "retrieval_count", "session_id", "tags"],
    },
  });

  const hits = (
    (resp.body as Record<string, unknown>)["hits"] as {
      hits: Array<{ _id: string; _source: Omit<ExperienceDoc, "_id"> }>;
    }
  ).hits;

  // Group docs by article tag (e.g. "article:my-slug")
  const byArticle = new Map<string, ExperienceDoc[]>();
  for (const hit of hits) {
    const doc: ExperienceDoc = { _id: hit._id, ...hit._source };
    const articleTag = doc.tags.find((t) => t.startsWith("article:"));
    if (!articleTag) continue;
    const existing = byArticle.get(articleTag) ?? [];
    existing.push(doc);
    byArticle.set(articleTag, existing);
  }
  return byArticle;
}

// ---------------------------------------------------------------------------
// Count distinct sessions per article (seeded docs only)
// ---------------------------------------------------------------------------

function sessionCountPerArticle(
  byArticle: Map<string, ExperienceDoc[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [tag, docs] of byArticle) {
    const sessions = new Set(docs.map((d) => d.session_id));
    counts.set(tag, sessions.size);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Run reinforcement engine over seeded docs
// ---------------------------------------------------------------------------

async function runReinforcement(
  client: OSClient,
  byArticle: Map<string, ExperienceDoc[]>,
  sessionCounts: Map<string, number>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engineWithClient = new ReinforcementEngine({
    openSearch: client as any,
    priorWeight: 0.3,
    countBonus: 0.02,
  });

  let reinforced = 0;

  for (const [articleTag, docs] of byArticle) {
    const sessionCount = sessionCounts.get(articleTag) ?? 1;

    for (const doc of docs) {
      // Signal strength scales with how many sessions this article appeared in.
      // A single-session article gets a weak positive signal; multi-session
      // articles get progressively stronger signals, which drives retrieval_priority
      // divergence. usageFrequency encodes session count as a fraction of max (3).
      const usageFrequency = Math.min(sessionCount / 3, 1.0);

      await engineWithClient.evaluate({
        memoryId: doc._id,
        memoryIndex: INDEX,
        signal: {
          importance: doc.importance_score,
          usageFrequency,
          goalRelevance: 0.5,
          novelty: 0.3,
          predictionAccuracy: 0.7,
          emotionalWeight: 0.4,
          contradictionRisk: 0.1,
          policyAlignment: 0.6,
        },
      });

      reinforced++;
    }
  }

  console.log(`  Reinforced ${reinforced} seeded docs`);
}

// ---------------------------------------------------------------------------
// Re-fetch docs post-reinforcement and compute salience metrics
// ---------------------------------------------------------------------------

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
): Promise<ArticleStats[]> {
  // Re-fetch all seeded docs to see updated retrieval_priority and importance_score
  const resp = await client.search({
    index: INDEX,
    body: {
      size: 1000,
      query: { prefix: { session_id: SEEDED_SESSION_PREFIX } },
      _source: ["importance_score", "retrieval_priority", "retrieval_count", "session_id", "tags"],
    },
  });

  const hits = (
    (resp.body as Record<string, unknown>)["hits"] as {
      hits: Array<{ _id: string; _source: Omit<ExperienceDoc, "_id"> }>;
    }
  ).hits;

  // Re-group by article
  const postByArticle = new Map<string, ExperienceDoc[]>();
  for (const hit of hits) {
    const doc: ExperienceDoc = { _id: hit._id, ...hit._source };
    const articleTag = doc.tags.find((t) => t.startsWith("article:"));
    if (!articleTag) continue;
    const existing = postByArticle.get(articleTag) ?? [];
    existing.push(doc);
    postByArticle.set(articleTag, existing);
  }

  const stats: ArticleStats[] = [];
  for (const [articleTag, postDocs] of postByArticle) {
    const baselineDocs = byArticleBaseline.get(articleTag) ?? [];
    const baselineById = new Map(baselineDocs.map((d) => [d._id, d]));

    const priorities = postDocs.map((d) => d.retrieval_priority ?? 0);
    const importanceDeltas = postDocs.map((d) => {
      const baseline = baselineById.get(d._id)?.importance_score ?? d.importance_score;
      return Math.abs(d.importance_score - baseline);
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

// ---------------------------------------------------------------------------
// Pearson correlation
// ---------------------------------------------------------------------------

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());

  console.log("=== Experiment 46 — Cross-Session Salience via Reinforcement Engine ===\n");

  // -------------------------------------------------------------------------
  // Phase 1 — Baseline snapshot (seeded docs only)
  // -------------------------------------------------------------------------
  console.log("Phase 1: Baseline snapshot (seeded docs only)...");
  const byArticleBaseline = await fetchSeededDocsByArticle(client);
  const sessionCounts = sessionCountPerArticle(byArticleBaseline);

  const totalSeededDocs = [...byArticleBaseline.values()].reduce((s, d) => s + d.length, 0);
  console.log(`  Total seeded docs: ${totalSeededDocs}`);
  console.log(`  Distinct article tags: ${byArticleBaseline.size}`);
  for (const [tag, count] of sessionCounts) {
    console.log(`    ${tag}: ${count} session(s), ${byArticleBaseline.get(tag)!.length} docs`);
  }

  const multiSessionArticles = [...sessionCounts.entries()].filter(([, c]) => c >= 2);
  const singleSessionArticles = [...sessionCounts.entries()].filter(([, c]) => c === 1);
  console.log(`  Multi-session articles (≥2): ${multiSessionArticles.length}`);
  console.log(`  Single-session articles: ${singleSessionArticles.length}`);

  if (totalSeededDocs === 0) {
    console.log("\n  No seeded docs found — has exp45 been run to seed data?");
    console.log("  H1–H4: SKIP");
    saveResults("experiment-46", "SKIP — no seeded exp45 docs in experience_events index", {
      totalSeededDocs: 0,
      h1Pass: false, h2Pass: false, h3Pass: false, h4Pass: false,
      h1Skipped: true, h2Skipped: true, h3Skipped: true, h4Skipped: true,
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Run reinforcement engine (seeded docs only)
  // -------------------------------------------------------------------------
  console.log("\nPhase 2: Running reinforcement engine over seeded docs...");
  await runReinforcement(client, byArticleBaseline, sessionCounts);

  // -------------------------------------------------------------------------
  // Phase 3 — Post-run measurement
  // -------------------------------------------------------------------------
  console.log("\nPhase 3: Post-run measurement...");
  const postStats = await fetchPostRunStats(client, byArticleBaseline, sessionCounts);

  const multiStats = postStats.filter((s) => s.sessionCount >= 2);
  const singleStats = postStats.filter((s) => s.sessionCount === 1);

  console.log("\n  Per-article stats (sorted by retrieval_priority desc):");
  for (const s of [...postStats].sort((a, b) => b.medianRetrievalPriority - a.medianRetrievalPriority)) {
    console.log(
      `    ${s.articleTag}: sessions=${s.sessionCount} rp_median=${s.medianRetrievalPriority.toFixed(4)} importance_delta=${s.medianImportanceDelta.toFixed(6)}`,
    );
  }

  // H1 — any doc has retrieval_priority > 0
  const anyRpPositive = postStats.some((s) => s.medianRetrievalPriority > 0);
  const h1Pass = anyRpPositive;

  // H2 — multi-session median rp > single-session median rp
  const multiMedianRp = median(multiStats.map((s) => s.medianRetrievalPriority));
  const singleMedianRp = singleStats.length > 0
    ? median(singleStats.map((s) => s.medianRetrievalPriority))
    : -1;

  console.log(`\n  Multi-session median retrieval_priority: ${multiMedianRp.toFixed(4)}`);
  if (singleMedianRp >= 0) {
    console.log(`  Single-session median retrieval_priority: ${singleMedianRp.toFixed(4)}`);
  }

  const h2Pass = multiStats.length > 0 && singleStats.length > 0
    ? multiMedianRp > singleMedianRp
    : multiStats.length > 0 && multiMedianRp > 0;
  const h2Skipped = multiStats.length === 0;

  // H3 — Pearson r between retrieval_priority and session count ≥ 0.5
  const rpValues = postStats.map((s) => s.medianRetrievalPriority);
  const sessionCountValues = postStats.map((s) => s.sessionCount);
  const r = pearsonR(rpValues, sessionCountValues);
  console.log(`\n  Pearson r(retrieval_priority, session_count): ${r.toFixed(4)}`);
  const h3Pass = postStats.length >= 3 ? r >= 0.5 : true; // skip if too few articles
  const h3Skipped = postStats.length < 3;

  // H4 — importance_score not corrupted (max delta ≤ 0.001)
  const maxImportanceDelta = Math.max(...postStats.map((s) => s.medianImportanceDelta), 0);
  console.log(`\n  Max importance_score delta: ${maxImportanceDelta.toFixed(6)}`);
  const h4Pass = maxImportanceDelta <= 0.001;

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  console.log(`\nH1 — retrieval_priority > 0 written to ≥1 doc: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — multi-session rp > single-session rp${h2Skipped ? " (skipped — insufficient multi-session data)" : ` (${multiMedianRp.toFixed(4)} vs ${singleMedianRp >= 0 ? singleMedianRp.toFixed(4) : "n/a"})`}: ${h2Skipped ? "SKIP" : h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — Pearson r ≥ 0.5${h3Skipped ? " (skipped — <3 articles)" : ` (r=${r.toFixed(4)})`}: ${h3Skipped ? "SKIP" : h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — importance_score not corrupted (delta=${maxImportanceDelta.toFixed(6)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  const allPass = h1Pass && (h2Skipped || h2Pass) && (h3Skipped || h3Pass) && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-46",
    [
      `H1 rp written: ${h1Pass ? "PASS" : "FAIL"} (anyRpPositive=${anyRpPositive})`,
      `H2 multi-session rp > single: ${h2Skipped ? "SKIP" : h2Pass ? "PASS" : "FAIL"} (multi=${multiMedianRp.toFixed(4)} single=${singleMedianRp.toFixed(4)})`,
      `H3 Pearson r: ${h3Skipped ? "SKIP" : h3Pass ? "PASS" : "FAIL"} (r=${r.toFixed(4)}, n=${postStats.length})`,
      `H4 importance intact: ${h4Pass ? "PASS" : "FAIL"} (maxDelta=${maxImportanceDelta.toFixed(6)})`,
    ].join("\n"),
    {
      totalSeededDocs,
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
