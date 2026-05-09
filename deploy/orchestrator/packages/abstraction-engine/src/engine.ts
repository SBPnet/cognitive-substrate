import { randomUUID } from "node:crypto";
import type { AbstractionInput, AbstractionLevel, AbstractionNode, CompressionLadder } from "./types.js";

const LEVELS: ReadonlyArray<AbstractionLevel> = ["experience", "pattern", "concept", "principle", "worldview"];

export class AbstractionEngine {
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
