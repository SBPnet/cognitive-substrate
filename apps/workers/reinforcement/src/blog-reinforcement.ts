/**
 * Periodic blog salience reinforcement over live `tags:blog` docs.
 *
 * Mirrors Exp 50 offline protocol: sample up to MAX_DOCS_PER_ARTICLE per
 * article tag, set usageFrequency from distinct session counts, and write
 * retrieval_priority via ReinforcementEngine.
 */

import type { Client } from "@opensearch-project/opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";

const INDEX = "experience_events";
const SEEDED_SESSION_PREFIX = "exp45-";
const MAX_DOCS_PER_ARTICLE = 3;

interface ExperienceDoc {
  _id: string;
  importance_score: number;
  session_id: string;
  tags: string[];
}

export async function runBlogReinforcementPass(
  openSearch: Client,
  log: (msg: string) => void = () => undefined,
): Promise<{ reinforced: number; articles: number }> {
  const resp = await openSearch.search({
    index: INDEX,
    body: {
      size: 2000,
      query: {
        bool: {
          must: [{ term: { tags: "blog" } }],
          must_not: [{ prefix: { session_id: SEEDED_SESSION_PREFIX } }],
        },
      },
      _source: ["importance_score", "session_id", "tags"],
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

  const engine = new ReinforcementEngine({
    openSearch: openSearch as never,
    priorWeight: 0.3,
    countBonus: 0.02,
  });

  let reinforced = 0;
  for (const [articleTag, docs] of byArticle) {
    const sessionCount = new Set(docs.map((d) => d.session_id)).size;
    const usageFrequency = Math.min(sessionCount / 3, 1.0);
    for (const doc of docs.slice(0, MAX_DOCS_PER_ARTICLE)) {
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
      reinforced += 1;
    }
    void articleTag;
  }

  log(`Blog reinforcement: ${reinforced} docs across ${byArticle.size} articles`);
  return { reinforced, articles: byArticle.size };
}

/** Interval ms between blog reinforcement passes (default 6h). */
export function blogReinforcementIntervalMs(): number {
  const raw = process.env["BLOG_REINFORCEMENT_INTERVAL_MS"];
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 6 * 60 * 60 * 1000;
}
