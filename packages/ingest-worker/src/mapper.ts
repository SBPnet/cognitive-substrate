/**
 * Maps blog TelemetryEvents to ExperienceEvents for the cognitive pipeline.
 *
 * Blog events are behavioural signals (page views, scroll depth, article
 * completions, etc.). We translate them into the EventType vocabulary and
 * assign an importance score based on signal strength:
 *
 *   article_complete  → highest (deliberate, full read)
 *   scroll_depth 100  → high
 *   scroll_depth 75   → medium-high
 *   snippet_copy      → medium (intent to use)
 *   repo_click        → medium
 *   search_query      → medium (curiosity signal)
 *   related_article_click → low-medium
 *   scroll_depth 25/50 → low (passive)
 *   focus_loss        → lowest (disengagement)
 *   page_view         → baseline
 *   focus_gain        → baseline
 */

import { randomUUID } from "node:crypto";
import type { ExperienceEvent, EventContext } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// TelemetryEvent shape (mirrors @bigpines/telemetry — kept local to avoid
// cross-repo dependency; update if blog event types change)
// ---------------------------------------------------------------------------

interface TelemetryEventBase {
  timestamp: string;
  sessionId: string;
  articleSlug?: string;
  referrer?: string;
  userAgent?: string;
  semanticTopicTags?: string[];
  readerId?: string;
  sessionCount?: number;
  firstSeen?: string;
}

interface PageViewEvent extends TelemetryEventBase {
  type: "page_view";
  payload: { path: string; title: string };
}

interface ArticleCompleteEvent extends TelemetryEventBase {
  type: "article_complete";
  payload: { slug: string; readingTimeMs: number };
}

interface ScrollDepthEvent extends TelemetryEventBase {
  type: "scroll_depth";
  payload: { depth: 25 | 50 | 75 | 90 };
}

interface CopyCodeEvent extends TelemetryEventBase {
  type: "copy_code";
  payload: { path: string; title: string; language: string; snippet: string };
}

interface SnippetCopyEvent extends TelemetryEventBase {
  type: "snippet_copy";
  payload: { file: string; lang: string };
}

interface RepoClickEvent extends TelemetryEventBase {
  type: "repo_click";
  payload: { url: string; label?: string };
}

interface SearchQueryEvent extends TelemetryEventBase {
  type: "search_query";
  payload: { query: string; resultCount: number };
}

interface FocusGainEvent extends TelemetryEventBase {
  type: "focus_gain";
  payload: { path: string };
}

interface FocusLossEvent extends TelemetryEventBase {
  type: "focus_loss";
  payload: { path: string; durationMs: number };
}

interface RelatedArticleClickEvent extends TelemetryEventBase {
  type: "related_article_click";
  payload: { fromSlug: string; toSlug: string; position: number };
}

interface OutboundLinkEvent extends TelemetryEventBase {
  type: "outbound_link";
  payload: { path: string; title: string; href: string };
}

interface NavClickEvent extends TelemetryEventBase {
  type: "nav_click";
  payload: { label: string; href: string };
}

interface TagClickEvent extends TelemetryEventBase {
  type: "tag_click";
  payload: { tag: string; context: "article" | "index" | "tags_page" };
}

interface SeriesNavClickEvent extends TelemetryEventBase {
  type: "series_nav_click";
  payload: { fromSlug: string; toSlug: string; direction: "prev" | "next" };
}

interface TimeOnPageEvent extends TelemetryEventBase {
  type: "time_on_page";
  payload: { path: string; title?: string; seconds: number; completed?: boolean };
}

interface SearchResultClickEvent extends TelemetryEventBase {
  type: "search_result_click";
  payload: { query: string; slug: string; position: number };
}

export type TelemetryEvent =
  | PageViewEvent
  | ArticleCompleteEvent
  | ScrollDepthEvent
  | CopyCodeEvent
  | SnippetCopyEvent
  | RepoClickEvent
  | SearchQueryEvent
  | FocusGainEvent
  | FocusLossEvent
  | RelatedArticleClickEvent
  | OutboundLinkEvent
  | NavClickEvent
  | TagClickEvent
  | SeriesNavClickEvent
  | TimeOnPageEvent
  | SearchResultClickEvent;

// ---------------------------------------------------------------------------
// Importance scoring
// ---------------------------------------------------------------------------

function importanceScore(event: TelemetryEvent): number {
  switch (event.type) {
    case "article_complete":
      // Reading time bonus: longer reads = more engagement. Cap at 1.0.
      return Math.min(0.85 + (event.payload.readingTimeMs / 600_000) * 0.15, 1.0);

    case "scroll_depth":
      return { 90: 0.75, 75: 0.55, 50: 0.30, 25: 0.15 }[event.payload.depth];

    case "copy_code":
      return 0.65;

    case "snippet_copy":
      return 0.65;

    case "repo_click":
      return 0.60;

    case "search_query":
      // More results = less novel query; fewer results = niche curiosity signal
      return event.payload.resultCount === 0 ? 0.70 : 0.50;

    case "related_article_click":
      // Earlier position in recommendations list = higher confidence match
      return Math.max(0.40 - event.payload.position * 0.05, 0.20);

    case "focus_loss":
      // Long dwell before loss = more meaningful engagement
      return Math.min(0.10 + (event.payload.durationMs / 120_000) * 0.20, 0.30);

    case "outbound_link":
      return 0.55;

    case "nav_click":
      return 0.05;

    case "tag_click":
      // Article context = stronger interest signal than browsing the index
      return event.payload.context === "article" ? 0.20 : 0.15;

    case "series_nav_click":
      // Progressing through a series is a strong deep-engagement signal
      return 0.45;

    case "time_on_page":
      // Longer dwell is a stronger engagement signal; completed reads score higher.
      return Math.min(
        0.15 + (event.payload.seconds / 180) * 0.35 + (event.payload.completed ? 0.15 : 0),
        0.70,
      );

    case "search_result_click":
      return Math.max(0.45 - event.payload.position * 0.05, 0.20);

    case "page_view":
    case "focus_gain":
      return 0.10;
  }
}

// ---------------------------------------------------------------------------
// Summary text
// ---------------------------------------------------------------------------

function buildSummary(event: TelemetryEvent): string {
  const slug = event.articleSlug ?? "unknown";
  switch (event.type) {
    case "page_view":
      return `page view: ${event.payload.path} — ${event.payload.title}`;

    case "article_complete":
      return `article complete: ${event.payload.slug} read in ${Math.round(event.payload.readingTimeMs / 1000)}s`;

    case "scroll_depth":
      return `scroll depth ${event.payload.depth}% on ${slug}`;

    case "copy_code":
      return `code copied: ${event.payload.language} snippet on ${slug} — "${event.payload.snippet.slice(0, 60)}"`;

    case "snippet_copy":
      return `code snippet copied: ${event.payload.file} (${event.payload.lang}) on ${slug}`;

    case "repo_click":
      return `repo link clicked: ${event.payload.label ?? event.payload.url} on ${slug}`;

    case "search_query":
      return `search query: "${event.payload.query}" (${event.payload.resultCount} results)`;

    case "focus_gain":
      return `focus gained on ${event.payload.path}`;

    case "focus_loss":
      return `focus lost on ${event.payload.path} after ${Math.round(event.payload.durationMs / 1000)}s`;

    case "related_article_click":
      return `related article click: ${event.payload.fromSlug} → ${event.payload.toSlug} (position ${event.payload.position})`;

    case "outbound_link":
      return `outbound link clicked: ${event.payload.href} on ${slug}`;

    case "nav_click":
      return `nav click: ${event.payload.label} → ${event.payload.href}`;

    case "tag_click":
      return `tag click: "${event.payload.tag}" (${event.payload.context})`;

    case "series_nav_click":
      return `series nav: ${event.payload.direction} from ${event.payload.fromSlug} → ${event.payload.toSlug}`;

    case "time_on_page":
      return `time on page: ${event.payload.path} (${event.payload.seconds}s${event.payload.completed ? ", completed" : ""})`;

    case "search_result_click":
      return `search result click: "${event.payload.query}" → ${event.payload.slug} (position ${event.payload.position})`;
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function buildTags(event: TelemetryEvent): string[] {
  const tags: string[] = ["blog", `event:${event.type}`];

  if (event.articleSlug) tags.push(`article:${event.articleSlug}`);
  if (event.semanticTopicTags) tags.push(...event.semanticTopicTags);

  switch (event.type) {
    case "article_complete":
      tags.push("engagement:deep");
      break;
    case "scroll_depth":
      tags.push(event.payload.depth >= 75 ? "engagement:deep" : "engagement:shallow");
      break;
    case "copy_code":
    case "snippet_copy":
    case "repo_click":
      tags.push("engagement:conversion");
      break;
    case "search_query":
      tags.push("engagement:curiosity");
      break;
    case "outbound_link":
      tags.push("engagement:conversion");
      break;
    case "focus_loss":
      tags.push("engagement:exit");
      break;
    case "nav_click":
      tags.push("engagement:navigation");
      break;
    case "tag_click":
      tags.push("engagement:curiosity", `tag:${event.payload.tag}`);
      break;
    case "series_nav_click":
      tags.push("engagement:deep");
      break;
    case "time_on_page":
      tags.push(
        event.payload.seconds >= 60 || event.payload.completed
          ? "engagement:deep"
          : "engagement:shallow",
      );
      break;
    case "search_result_click":
      tags.push("engagement:curiosity", `article:${event.payload.slug}`);
      break;
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Registry bridge
// ---------------------------------------------------------------------------

// Imported here so mapper-registry.ts can import from plugin-loader without
// creating a circular dependency (mapper.ts → mapper-registry.ts → plugin-loader,
// but plugin-loader does not import from ingest-worker).
import type { IngestMapperRegistry } from "./mapper-registry.js";

/**
 * Registers all built-in TelemetryEvent type handlers into a registry.
 * Call this once at startup before loading plugin mappers so that built-in
 * types are always available and plugins cannot silently shadow them.
 */
export function registerBuiltinMappers(registry: IngestMapperRegistry): void {
  const builtinTypes: ReadonlyArray<TelemetryEvent["type"]> = [
    "page_view",
    "article_complete",
    "scroll_depth",
    "copy_code",
    "snippet_copy",
    "repo_click",
    "search_query",
    "focus_gain",
    "focus_loss",
    "related_article_click",
    "outbound_link",
    "nav_click",
    "tag_click",
    "series_nav_click",
    "time_on_page",
    "search_result_click",
  ];

  for (const type of builtinTypes) {
    registry.register(type, (ev) =>
      mapTelemetryToExperience(ev as TelemetryEvent),
    );
  }
}

export function mapTelemetryToExperience(event: TelemetryEvent): ExperienceEvent {
  const context: EventContext = {
    sessionId: event.sessionId,
    source: "ambient",
    ...(event.readerId !== undefined ? { userId: event.readerId } : {}),
    agentId: "ingest-worker",
    traceId: randomUUID(),
  };

  return {
    eventId: randomUUID(),
    timestamp: event.timestamp,
    type: "environmental_observation",
    context,
    input: {
      text: buildSummary(event),
      // Embedding is generated by the OpenSearch ingest pipeline at index time.
      embedding: [],
    },
    importanceScore: importanceScore(event),
    tags: buildTags(event),
  };
}
