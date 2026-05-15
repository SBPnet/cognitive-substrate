/**
 * Abstraction engine — compression ladder builder.
 *
 * When sources carry embeddings the engine uses incremental cosine-similarity
 * clustering to build the ladder: each level retains the half of sources
 * closest to the centroid of the previous level, so higher levels represent
 * a tighter, more representative cluster and produce differentiated labels.
 *
 * When no embeddings are present the engine falls back to the original
 * symbolic-label behaviour (most-frequent long token, same source set at
 * every level).
 */

import { randomUUID } from "node:crypto";
import type { AbstractionInput, AbstractionLevel, AbstractionNode, CompressionLadder } from "./types.js";

/**
 * Canonical ordering of ladder levels, from most concrete to most general.
 * The engine produces exactly one node per level in this order.
 */
const LEVELS: ReadonlyArray<AbstractionLevel> = ["experience", "pattern", "concept", "principle", "worldview"];

/** Minimum sources to keep at any level — prevents the top levels from having too few. */
const MIN_CLUSTER_SIZE = 2;

export class AbstractionEngine {
  /**
   * Builds a compression ladder from the supplied events and memories.
   * Returns a ladder containing one node per level in `LEVELS`.
   *
   * When sources carry embeddings each level clusters to the most
   * representative half of the previous level's sources (cosine centroid).
   * When embeddings are absent the symbolic-label fallback is used.
   */
  buildCompressionLadder(input: AbstractionInput): CompressionLadder {
    const sources: SourceItem[] = [
      ...(input.events ?? []).map((event): SourceItem => ({
        id: event.eventId,
        text: event.input.text,
        ...(event.input.embedding.length > 0 ? { embedding: [...event.input.embedding] } : {}),
      })),
      ...(input.memories ?? []).map((memory): SourceItem => ({
        id: memory.memoryId,
        text: memory.generalization,
        ...(memory.embedding.length > 0 ? { embedding: [...memory.embedding] } : {}),
      })),
    ];

    const hasEmbeddings = sources.some((s) => s.embedding !== undefined);

    let levelSources = sources;
    const nodes = LEVELS.map((level, depth) => {
      if (hasEmbeddings) {
        levelSources = clusterTocentroid(levelSources, depth);
      }
      return createNode(level, levelSources, depth);
    });

    return { ladderId: randomUUID(), nodes };
  }
}

/**
 * Picks the most frequent token longer than four characters from a batch
 * of texts. Used as the label generator at every level.
 */
export function symbolicLabel(texts: ReadonlyArray<string>): string {
  const counts = texts.join(" ").toLowerCase().split(/\W+/u).reduce<Map<string, number>>((map, token) => {
    if (token.length > 4) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "general-abstraction";
}

// ---------------------------------------------------------------------------
// Embedding-based clustering
// ---------------------------------------------------------------------------

interface SourceItem {
  readonly id: string;
  readonly text: string;
  readonly embedding?: number[];
}

/**
 * Retain the top-50% of sources (by cosine similarity to the centroid),
 * shrinking toward the most representative cluster at each ladder level.
 * Always keeps at least MIN_CLUSTER_SIZE sources.
 */
function clusterTocentroid(sources: ReadonlyArray<SourceItem>, depth: number): SourceItem[] {
  const embedded = sources.filter((s) => s.embedding !== undefined);
  if (embedded.length === 0) return [...sources];

  const centroid = computeCentroid(embedded.map((s) => s.embedding!));
  const targetSize = Math.max(MIN_CLUSTER_SIZE, Math.ceil(sources.length / Math.pow(2, depth)));

  // Sort by cosine similarity to centroid (descending)
  const ranked = [...embedded].sort((a, b) =>
    cosineSimilarity(b.embedding!, centroid) - cosineSimilarity(a.embedding!, centroid),
  );

  return ranked.slice(0, Math.min(targetSize, ranked.length));
}

function computeCentroid(embeddings: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const dim = embeddings[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) sum[i]! += emb[i]!;
  }
  return sum.map((v) => v / embeddings.length);
}

function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Node construction
// ---------------------------------------------------------------------------

function createNode(
  level: AbstractionLevel,
  sources: ReadonlyArray<SourceItem>,
  depth: number,
): AbstractionNode {
  return {
    nodeId: randomUUID(),
    level,
    label: `${level}:${symbolicLabel(sources.map((s) => s.text))}`,
    sourceIds: sources.map((s) => s.id),
    compressionRatio: clamp((depth + 1) / LEVELS.length),
    confidence: clamp(sources.length / Math.max(1, 8 - depth)),
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
