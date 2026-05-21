/**
 * Memory Critique Events (MCEs) — structured signals emitted when an agent
 * disagrees with its own retrieved memories. MCEs are first-class Kafka
 * events consumed by the memory-critique worker, which can downgrade trust
 * scores, trigger early re-consolidation, inject competing memories, or
 * raise suppression thresholds for similar future retrievals.
 *
 * The seed for this type is `AgentResult.critique` (a plain string today).
 * MCEs promote that string into a structured, actionable pipeline event.
 */

/** Reason the agent is challenging a retrieved memory. */
export type CritiqueType =
  | "contradiction"
  | "outdated"
  | "overgeneralized"
  | "missing_context"
  | "high_confidence_error";

/**
 * A structured critique emitted by an agent when it disagrees with a
 * retrieved memory. Published to the `memory.feedback` Kafka topic and
 * consumed by the Memory Critique Worker.
 */
export interface MemoryCritiqueEvent {
  readonly critiqueId: string;
  readonly timestamp: string;

  /** Session that produced this critique. */
  readonly sessionId: string;

  /** Agent that emitted the critique. */
  readonly agentId: string;

  /**
   * The specific memory being challenged. Either `memoryId` (for a known
   * document ID) or `clusterCentroid` (summary text of a cluster centroid
   * when the agent cannot identify a single document) should be provided.
   */
  readonly memoryId?: string;
  readonly clusterCentroid?: string;

  readonly critiqueType: CritiqueType;

  /**
   * How confident the agent is in this critique. Low-confidence critiques
   * (< 0.5) only log; high-confidence (>= 0.8) can trigger replacement.
   */
  readonly confidenceScore: number;

  /**
   * Optional free-text explanation. Will be embedded and stored alongside
   * the critique for audit and future retrieval.
   */
  readonly explanation?: string;

  /**
   * When confidenceScore >= 0.8, a proposed replacement memory summary.
   * The worker will inject this as a new memory at the same abstraction level.
   */
  readonly suggestedReplacement?: string;

  /**
   * Abstraction level of the critiqued memory. Critiques at `concept` or
   * `principle` level cascade down through the compression ladder.
   */
  readonly abstractionLevel?: "experience" | "pattern" | "concept" | "principle" | "worldview";
}
