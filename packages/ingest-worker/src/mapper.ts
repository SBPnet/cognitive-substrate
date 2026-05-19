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
  | RelatedArticleClickEvent;

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
    case "focus_loss":
      tags.push("engagement:exit");
      break;
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

export function mapTelemetryToExperience(event: TelemetryEvent): ExperienceEvent {
  const context: EventContext = {
    sessionId: event.sessionId,
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
