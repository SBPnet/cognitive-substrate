/**
 * Public-safe blog reader stats aggregations over experience_events.
 *
 * Used by the digest worker and as the reference shape for the blog's
 * /api/substrate/stats route. Never returns session_id, user_id, or
 * verbatim search query text.
 */

import type { Client } from "@opensearch-project/opensearch";

/** Live ingest tag plus legacy aliases kept for older seed docs. */
export const BLOG_STATS_TAGS = ["blog", "source:blog", "source:reader_telemetry"] as const;

const ENGAGEMENT_CLICK_TAGS = [
  "event:nav_click",
  "event:tag_click",
  "event:repo_click",
  "event:related_article_click",
  "event:search_result_click",
  "event:outbound_link",
  "event:series_nav_click",
] as const;

export interface BlogStatsWindow {
  readonly days: number;
  readonly since: string;
  readonly until: string;
}

export interface BlogStatsTotals {
  readonly sessions: number;
  readonly pageViews: number;
  readonly articleCompletes: number;
  readonly engagementClicks: number;
  readonly events: number;
}

export interface BlogArticleVolume {
  readonly slug: string;
  readonly events: number;
}

export interface BlogArticleSalience {
  readonly slug: string;
  readonly medianRetrievalPriority: number;
  readonly sessionCount: number;
  readonly docCount: number;
}

export interface BlogFunnel {
  readonly pageViews: number;
  readonly scrollDepth: number;
  readonly articleCompletes: number;
}

export interface BlogSlugStats {
  readonly slug: string;
  readonly pageViews: number;
  readonly articleCompletes: number;
  readonly completionRate: number;
  readonly medianRetrievalPriority: number | null;
  readonly sessionCount: number;
}

export interface BlogPublicStats {
  readonly window: BlogStatsWindow;
  readonly totals: BlogStatsTotals;
  readonly topArticles: ReadonlyArray<BlogArticleVolume>;
  readonly salience: ReadonlyArray<BlogArticleSalience>;
  readonly funnel: BlogFunnel;
  readonly article: BlogSlugStats | null;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function blogFilter(sinceIso: string): Record<string, unknown> {
  return {
    bool: {
      must: [
        { range: { timestamp: { gte: sinceIso } } },
        { terms: { tags: [...BLOG_STATS_TAGS] } },
      ],
    },
  };
}

function slugFromArticleTag(tag: string): string {
  return tag.replace(/^article:/, "");
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Aggregate public-safe blog stats for a rolling window.
 * When `slug` is set, also compute per-article completion and salience.
 */
export async function fetchBlogPublicStats(
  client: Client,
  options?: {
    readonly days?: number;
    readonly slug?: string;
    readonly topN?: number;
    readonly index?: string;
  },
): Promise<BlogPublicStats> {
  const days = options?.days ?? 7;
  const topN = options?.topN ?? 8;
  const index = options?.index ?? "experience_events";
  const since = daysAgoIso(days);
  const until = new Date().toISOString();
  const slug = options?.slug?.trim();

  const result = await client.search({
    index,
    body: {
      size: 0,
      query: blogFilter(since),
      aggs: {
        sessions: { cardinality: { field: "session_id" } },
        page_views: { filter: { term: { tags: "event:page_view" } } },
        article_completes: { filter: { term: { tags: "event:article_complete" } } },
        scroll_depth: { filter: { term: { tags: "event:scroll_depth" } } },
        engagement_clicks: { filter: { terms: { tags: [...ENGAGEMENT_CLICK_TAGS] } } },
        top_articles: {
          terms: { field: "tags", size: topN, include: "article:.*" },
        },
        by_article: {
          terms: { field: "tags", size: 50, include: "article:.*" },
          aggs: {
            sessions: { cardinality: { field: "session_id" } },
            median_rp: {
              percentiles: { field: "retrieval_priority", percents: [50] },
            },
          },
        },
        ...(slug
          ? {
              slug_filter: {
                filter: { term: { tags: `article:${slug}` } },
                aggs: {
                  page_views: { filter: { term: { tags: "event:page_view" } } },
                  article_completes: {
                    filter: { term: { tags: "event:article_complete" } },
                  },
                  sessions: { cardinality: { field: "session_id" } },
                  median_rp: {
                    percentiles: { field: "retrieval_priority", percents: [50] },
                  },
                },
              },
            }
          : {}),
      },
    },
  });

  const body = result.body as {
    hits?: { total?: { value?: number } | number };
    aggregations?: Record<string, unknown>;
  };
  const aggs = body.aggregations ?? {};
  const totalHits = body.hits?.total;
  const events =
    typeof totalHits === "number" ? totalHits : asNumber(totalHits?.value);

  const pageViews = asNumber((aggs["page_views"] as { doc_count?: number })?.doc_count);
  const articleCompletes = asNumber(
    (aggs["article_completes"] as { doc_count?: number })?.doc_count,
  );
  const scrollDepth = asNumber((aggs["scroll_depth"] as { doc_count?: number })?.doc_count);
  const engagementClicks = asNumber(
    (aggs["engagement_clicks"] as { doc_count?: number })?.doc_count,
  );
  const sessions = asNumber((aggs["sessions"] as { value?: number })?.value);

  const topBuckets =
    (
      aggs["top_articles"] as {
        buckets?: Array<{ key: string; doc_count: number }>;
      }
    )?.buckets ?? [];
  const topArticles: BlogArticleVolume[] = topBuckets.map((b) => ({
    slug: slugFromArticleTag(b.key),
    events: b.doc_count,
  }));

  const articleBuckets =
    (
      aggs["by_article"] as {
        buckets?: Array<{
          key: string;
          doc_count: number;
          sessions?: { value?: number };
          median_rp?: { values?: Record<string, number> };
        }>;
      }
    )?.buckets ?? [];

  const salience: BlogArticleSalience[] = articleBuckets
    .map((b) => {
      const median = b.median_rp?.values?.["50.0"];
      return {
        slug: slugFromArticleTag(b.key),
        medianRetrievalPriority:
          typeof median === "number" && Number.isFinite(median) ? median : 0,
        sessionCount: asNumber(b.sessions?.value),
        docCount: b.doc_count,
      };
    })
    .filter((a) => a.medianRetrievalPriority > 0)
    .sort((a, b) => b.medianRetrievalPriority - a.medianRetrievalPriority)
    .slice(0, topN);

  let article: BlogSlugStats | null = null;
  if (slug) {
    const slugAgg = aggs["slug_filter"] as
      | {
          doc_count?: number;
          page_views?: { doc_count?: number };
          article_completes?: { doc_count?: number };
          sessions?: { value?: number };
          median_rp?: { values?: Record<string, number> };
        }
      | undefined;
    const slugViews = asNumber(slugAgg?.page_views?.doc_count);
    const slugCompletes = asNumber(slugAgg?.article_completes?.doc_count);
    const median = slugAgg?.median_rp?.values?.["50.0"];
    article = {
      slug,
      pageViews: slugViews,
      articleCompletes: slugCompletes,
      completionRate: slugViews > 0 ? slugCompletes / slugViews : 0,
      medianRetrievalPriority:
        typeof median === "number" && Number.isFinite(median) ? median : null,
      sessionCount: asNumber(slugAgg?.sessions?.value),
    };
  }

  return {
    window: { days, since, until },
    totals: {
      sessions,
      pageViews,
      articleCompletes,
      engagementClicks,
      events,
    },
    topArticles,
    salience,
    funnel: {
      pageViews,
      scrollDepth,
      articleCompletes,
    },
    article,
  };
}

/** Empty-safe zeroed payload for degraded/offline OpenSearch. */
export function emptyBlogPublicStats(
  options?: { readonly days?: number; readonly slug?: string },
): BlogPublicStats {
  const days = options?.days ?? 7;
  const until = new Date().toISOString();
  return {
    window: { days, since: daysAgoIso(days), until },
    totals: {
      sessions: 0,
      pageViews: 0,
      articleCompletes: 0,
      engagementClicks: 0,
      events: 0,
    },
    topArticles: [],
    salience: [],
    funnel: { pageViews: 0, scrollDepth: 0, articleCompletes: 0 },
    article: options?.slug
      ? {
          slug: options.slug,
          pageViews: 0,
          articleCompletes: 0,
          completionRate: 0,
          medianRetrievalPriority: null,
          sessionCount: 0,
        }
      : null,
  };
}
