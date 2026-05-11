/**
 * Type surface for the abstraction engine.
 *
 * The abstraction engine compresses raw experience and consolidated semantic
 * memory into a five-level ladder of progressively more general
 * representations: experience -> pattern -> concept -> principle -> worldview.
 * Each level is materialised as an `AbstractionNode`; a complete pass over
 * the inputs produces a `CompressionLadder`.
 */

import type { ExperienceEvent, SemanticMemory } from "@cognitive-substrate/core-types";

/**
 * Levels of the abstraction ladder, ordered from most concrete to most
 * general. Higher levels carry stronger compression but lower fidelity to
 * any single source.
 */
export type AbstractionLevel = "experience" | "pattern" | "concept" | "principle" | "worldview";

/** A single node on the compression ladder. */
export interface AbstractionNode {
  readonly nodeId: string;
  readonly level: AbstractionLevel;
  readonly label: string;
  /** IDs of the source events or memories that contributed to this node. */
  readonly sourceIds: ReadonlyArray<string>;
  /**
   * Fraction of source content compressed into the label, in `[0, 1]`.
   * Higher levels of the ladder carry larger compression ratios.
   */
  readonly compressionRatio: number;
  /** Confidence that the label is representative of the sources, in `[0, 1]`. */
  readonly confidence: number;
}

/** Output of one abstraction pass: a connected ladder of nodes. */
export interface CompressionLadder {
  readonly ladderId: string;
  readonly nodes: ReadonlyArray<AbstractionNode>;
}

/**
 * Inputs accepted by the engine. Either or both arrays may be supplied;
 * raw events contribute their input text, semantic memories contribute
 * their generalisation field.
 */
export interface AbstractionInput {
  readonly events?: ReadonlyArray<ExperienceEvent>;
  readonly memories?: ReadonlyArray<SemanticMemory>;
}
