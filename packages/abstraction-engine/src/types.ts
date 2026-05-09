import type { ExperienceEvent, SemanticMemory } from "@cognitive-substrate/core-types";

export type AbstractionLevel = "experience" | "pattern" | "concept" | "principle" | "worldview";

export interface AbstractionNode {
  readonly nodeId: string;
  readonly level: AbstractionLevel;
  readonly label: string;
  readonly sourceIds: ReadonlyArray<string>;
  readonly compressionRatio: number;
  readonly confidence: number;
}

export interface CompressionLadder {
  readonly ladderId: string;
  readonly nodes: ReadonlyArray<AbstractionNode>;
}

export interface AbstractionInput {
  readonly events?: ReadonlyArray<ExperienceEvent>;
  readonly memories?: ReadonlyArray<SemanticMemory>;
}
