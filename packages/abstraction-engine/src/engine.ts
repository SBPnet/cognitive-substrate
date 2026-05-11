/**
 * Reference abstraction engine.
 *
 * The current implementation is deliberately heuristic: it produces a
 * five-level ladder by reusing the same source set at every level and
 * deriving a label from the most common long token. This is enough for
 * downstream tests and for visualising the ladder structure, but is not
 * the final algorithm. Future revisions are expected to build the ladder
 * incrementally by clustering at each level rather than collapsing all
 * sources into every node.
 */

import { randomUUID } from "node:crypto";
import type { AbstractionInput, AbstractionLevel, AbstractionNode, CompressionLadder } from "./types.js";

/**
 * Canonical ordering of ladder levels, from most concrete to most general.
 * The engine produces exactly one node per level in this order.
 */
const LEVELS: ReadonlyArray<AbstractionLevel> = ["experience", "pattern", "concept", "principle", "worldview"];

export class AbstractionEngine {
  /**
   * Builds a compression ladder from the supplied events and memories.
   * Returns a ladder containing one node per level in `LEVELS`.
   */
  buildCompressionLadder(input: AbstractionInput): CompressionLadder {
    const sources = [
      ...(input.events ?? []).map((event) => ({ id: event.eventId, text: event.input.text })),
      ...(input.memories ?? []).map((memory) => ({ id: memory.memoryId, text: memory.generalization })),
    ];
    const nodes = LEVELS.map((level, index) => createNode(level, sources, index));
    return {
      ladderId: randomUUID(),
      nodes,
    };
  }
}

/**
 * Picks the most frequent token longer than four characters from a batch
 * of texts. Used as a stand-in for a real label generator until the engine
 * is upgraded to call an embedding-based summariser.
 */
export function symbolicLabel(texts: ReadonlyArray<string>): string {
  const counts = texts.join(" ").toLowerCase().split(/\W+/u).reduce<Map<string, number>>((map, token) => {
    if (token.length > 4) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "general-abstraction";
}

function createNode(
  level: AbstractionLevel,
  sources: ReadonlyArray<{ readonly id: string; readonly text: string }>,
  depth: number,
): AbstractionNode {
  return {
    nodeId: randomUUID(),
    level,
    label: `${level}:${symbolicLabel(sources.map((source) => source.text))}`,
    sourceIds: sources.map((source) => source.id),
    compressionRatio: clamp((depth + 1) / LEVELS.length),
    confidence: clamp(sources.length / Math.max(1, 8 - depth)),
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
