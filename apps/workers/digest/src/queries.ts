/**
 * OpenSearch aggregation queries for the Weekly Memory Digest.
 * All queries are purely extractive — no LLM is involved.
 */

import type { Client } from "@opensearch-project/opensearch";

const BLOG_TAGS = ["source:blog", "source:reader_telemetry"];

export interface TagFrequency {
  readonly tag: string;
  readonly count: number;
  readonly avgImportance: number;
}

export interface TrustDeltaEntry {
  readonly memoryId: string;
  readonly summary: string;
  readonly retrievalPriorityDelta: number;
}

export interface AbstractionPattern {
  readonly level: string;
  readonly summary: string;
  readonly importance: number;
  readonly updatedAt: string;
}

export interface BehaviorAnomaly {
  readonly tag: string;
  readonly currentWeekCount: number;
  readonly priorWeekCount: number;
  readonly deltaPercent: number;
}

/** ISO timestamps for the past N days. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Query experience_events for the past 7 days tagged as blog/reader telemetry. */
export async function fetchWeeklyEvents(
  client: Client,
): Promise<{ totalCount: number; tags: TagFrequency[] }> {
  const sinceTs = daysAgo(7);

  const result = await client.search({
    index: "experience_events",
    body: {
      query: {
        bool: {
          must: [
            { range: { timestamp: { gte: sinceTs } } },
            { terms: { tags: BLOG_TAGS } },
          ],
        },
      },
      size: 0,
      aggs: {
        tag_frequencies: {
          terms: { field: "tags", size: 50 },
          aggs: {
            avg_importance: { avg: { field: "importance_score" } },
          },
        },
      },
    },
  });

   
  const body = result.body as any;
  const totalCount = body.hits?.total?.value ?? 0;

   
  const buckets: any[] = body.aggregations?.tag_frequencies?.buckets ?? [];
  const tags: TagFrequency[] = buckets
    .filter((b) => !BLOG_TAGS.includes(b.key as string))
    .map((b) => ({
      tag: b.key as string,
      count: b.doc_count as number,
      avgImportance: (b.avg_importance?.value as number | null) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { totalCount, tags };
}

/** Find semantic memories updated in the past 7 days at concept/principle level. */
export async function fetchRecentAbstractionPatterns(
  client: Client,
): Promise<AbstractionPattern[]> {
  const sinceTs = daysAgo(7);

  const result = await client.search({
    index: "memory_semantic",
    body: {
      query: {
        bool: {
          must: [
            { range: { updated_at: { gte: sinceTs } } },
            { terms: { abstraction_level: ["concept", "principle", "worldview"] } },
          ],
        },
      },
      sort: [{ importance_score: { order: "desc" } }],
      size: 10,
      _source: ["summary", "abstraction_level", "importance_score", "updated_at"],
    },
  });

   
  const hits: any[] = (result.body as any).hits?.hits ?? [];
  return hits.map((h) => ({
    level: h._source?.abstraction_level ?? "unknown",
    summary: h._source?.summary ?? "",
    importance: h._source?.importance_score ?? 0,
    updatedAt: h._source?.updated_at ?? "",
  }));
}

/** Find memories whose retrieval_priority changed significantly this week. */
export async function fetchTrustDeltaMemories(
  client: Client,
): Promise<TrustDeltaEntry[]> {
  const result = await client.search({
    index: "memory_semantic",
    body: {
      query: {
        bool: {
          must: [
            { range: { last_critique_at: { gte: daysAgo(7) } } },
          ],
        },
      },
      sort: [{ retrieval_priority: { order: "asc" } }],
      size: 10,
      _source: ["memory_id", "summary", "retrieval_priority"],
    },
  });

   
  const hits: any[] = (result.body as any).hits?.hits ?? [];
  return hits.map((h) => ({
    memoryId: h._source?.memory_id ?? h._id,
    summary: h._source?.summary ?? "",
    retrievalPriorityDelta: h._source?.retrieval_priority ?? 0,
  }));
}

/**
 * Compare tag frequency this week vs the prior week to detect anomalies.
 * Returns tags where count changed by >= 50%.
 */
export async function fetchBehaviorAnomalies(client: Client): Promise<BehaviorAnomaly[]> {
  const week1Start = daysAgo(14);
  const week1End = daysAgo(7);
  const week2Start = daysAgo(7);

  const [priorResult, currentResult] = await Promise.all([
    client.search({
      index: "experience_events",
      body: {
        query: { bool: { must: [{ range: { timestamp: { gte: week1Start, lt: week1End } } }, { terms: { tags: BLOG_TAGS } }] } },
        size: 0,
        aggs: { tags: { terms: { field: "tags", size: 50 } } },
      },
    }),
    client.search({
      index: "experience_events",
      body: {
        query: { bool: { must: [{ range: { timestamp: { gte: week2Start } } }, { terms: { tags: BLOG_TAGS } }] } },
        size: 0,
        aggs: { tags: { terms: { field: "tags", size: 50 } } },
      },
    }),
  ]);

   
  const priorBuckets: any[] = (priorResult.body as any).aggregations?.tags?.buckets ?? [];
   
  const currentBuckets: any[] = (currentResult.body as any).aggregations?.tags?.buckets ?? [];

  const priorMap = new Map<string, number>(priorBuckets.map((b) => [b.key as string, b.doc_count as number]));
  const currentMap = new Map<string, number>(currentBuckets.map((b) => [b.key as string, b.doc_count as number]));

  const anomalies: BehaviorAnomaly[] = [];
  for (const [tag, currentCount] of currentMap) {
    if (BLOG_TAGS.includes(tag)) continue;
    const priorCount = priorMap.get(tag) ?? 0;
    if (priorCount === 0 && currentCount < 3) continue;
    const deltaPercent = priorCount === 0
      ? 100
      : Math.round(((currentCount - priorCount) / priorCount) * 100);
    if (Math.abs(deltaPercent) >= 50) {
      anomalies.push({ tag, currentWeekCount: currentCount, priorWeekCount: priorCount, deltaPercent });
    }
  }
  return anomalies.sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent)).slice(0, 10);
}

/** Find topics tagged repeatedly but never as high-importance (potential knowledge gaps). */
export async function fetchKnowledgeGapTopics(client: Client): Promise<string[]> {
  const result = await client.search({
    index: "experience_events",
    body: {
      query: {
        bool: {
          must: [{ terms: { tags: BLOG_TAGS } }],
          filter: [{ range: { importance_score: { lt: 0.4 } } }],
        },
      },
      size: 0,
      aggs: { tags: { terms: { field: "tags", size: 30, min_doc_count: 5 } } },
    },
  });

   
  const buckets: any[] = (result.body as any).aggregations?.tags?.buckets ?? [];
  return buckets
    .filter((b) => !BLOG_TAGS.includes(b.key as string) && !(b.key as string).startsWith("source:"))
    .map((b) => b.key as string)
    .slice(0, 5);
}
