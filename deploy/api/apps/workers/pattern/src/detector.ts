import type { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import type {
  OperationalPrimitiveEvent,
  OperationalPattern,
  PatternMatch,
} from "@cognitive-substrate/abstraction-engine";
import { SEED_PATTERNS } from "@cognitive-substrate/abstraction-engine";

const OPERATIONAL_PATTERNS_INDEX = "operational_patterns";
const DETECTION_WINDOW_MS = 5 * 60 * 1000;
const CONFIDENCE_THRESHOLD = 0.65;
const MAX_PATTERN_CANDIDATES = 10;

/**
 * A sliding window of recent primitive events used for pattern matching.
 */
export class PrimitiveWindow {
  private readonly window: OperationalPrimitiveEvent[] = [];

  push(event: OperationalPrimitiveEvent): void {
    const cutoff = Date.now() - DETECTION_WINDOW_MS;
    // Evict events older than the detection window
    let i = 0;
    while (i < this.window.length && this.window[i]!.timestamp.getTime() < cutoff) {
      i++;
    }
    if (i > 0) this.window.splice(0, i);
    this.window.push(event);
  }

  get activePrimitives(): ReadonlySet<string> {
    return new Set(this.window.map((e) => e.primitiveId));
  }

  get events(): ReadonlyArray<OperationalPrimitiveEvent> {
    return this.window;
  }
}

/**
 * Match active primitives in the window against the pattern library.
 *
 * Matching strategy:
 *   1. Full signature match: all primitives in pattern.signature are present →
 *      high confidence, scaled by the pattern's baseline confidence.
 *   2. Precursor match: all precursors are present but signature is incomplete →
 *      lower confidence, emitted as early-warning.
 */
export function matchPatterns(
  window: PrimitiveWindow,
  patterns: ReadonlyArray<OperationalPattern>,
): PatternMatch[] {
  const active = window.activePrimitives;
  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    const signatureMatched = pattern.signature.every((p) => active.has(p));
    const precursorsMatched = pattern.precursors.every((p) => active.has(p));

    if (signatureMatched) {
      matches.push({
        pattern,
        matchScore: pattern.confidence,
      });
    } else if (precursorsMatched && pattern.precursors.length > 0) {
      // Partial match: precursors suggest this pattern may be developing
      const partialScore = pattern.confidence * 0.5;
      if (partialScore >= CONFIDENCE_THRESHOLD) {
        matches.push({ pattern, matchScore: partialScore });
      }
    }
  }

  return matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_PATTERN_CANDIDATES);
}

/**
 * Load the operational patterns index from OpenSearch.
 * Falls back to the built-in seed patterns if the index is empty or unavailable.
 */
export async function loadPatterns(
  openSearch: OpenSearchClient,
): Promise<OperationalPattern[]> {
  try {
    const response = await openSearch.search({
      index: OPERATIONAL_PATTERNS_INDEX,
      body: {
        query: { match_all: {} },
        size: 1000,
        sort: [{ confidence: { order: "desc" } }],
      },
    });

    const body = response.body as { hits?: { hits?: Array<{ _source: unknown }> } };
    const hits = body["hits"]?.["hits"];
    if (!hits || hits.length === 0) {
      return [...SEED_PATTERNS];
    }

    return hits.map((h) => h._source as OperationalPattern);
  } catch {
    return [...SEED_PATTERNS];
  }
}

/**
 * Upsert an operational pattern into OpenSearch, updating confidence and counts.
 */
export async function upsertPattern(
  openSearch: OpenSearchClient,
  pattern: OperationalPattern,
): Promise<void> {
  await openSearch.index({
    index: OPERATIONAL_PATTERNS_INDEX,
    id: pattern.patternId,
    body: {
      ...pattern,
      createdAt: pattern.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
}

export { CONFIDENCE_THRESHOLD };
