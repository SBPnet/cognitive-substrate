/**
 * Memory-layer types spanning episodic references, semantic abstractions,
 * memory graph links, and retrieval feedback records.
 */

/** A lightweight pointer to a memory held in OpenSearch or object storage. */
export interface MemoryReference {
  readonly memoryId: string;
  readonly index: MemoryIndex;
  readonly score: number;
  readonly summary: string;
  readonly importanceScore: number;
  readonly lastRetrieved?: string;
}

/** OpenSearch index identifiers used across the memory substrate. */
export type MemoryIndex =
  | "experience_events"
  | "memory_semantic"
  | "policy_state"
  | "agent_activity"
  | "world_model_predictions"
  | "goal_system"
  | "identity_state"
  | "self_modifications"
  | "memory_links"
  | "retrieval_feedback";

/** Relationship type between two memories in the associative graph. */
export type MemoryLinkType =
  | "causal"
  | "temporal"
  | "semantic"
  | "contradicts"
  | "generalizes"
  | "derived_from";

/** A directed edge in the memory association graph. */
export interface MemoryLink {
  readonly linkId: string;
  readonly sourceMemoryId: string;
  readonly targetMemoryId: string;
  readonly relationshipType: MemoryLinkType;
  readonly strength: number;
  readonly createdAt: string;
}

/** A consolidated semantic memory — the output of one consolidation cycle. */
export interface SemanticMemory {
  readonly memoryId: string;
  readonly createdAt: string;
  readonly summary: string;
  readonly generalization: string;
  readonly embedding: ReadonlyArray<number>;
  readonly sourceEventIds: ReadonlyArray<string>;
  readonly importanceScore: number;
  readonly stabilityScore: number;
  readonly contradictionScore: number;
  readonly semanticCluster?: string;
  readonly usageFrequency: number;
  readonly lastRetrieved?: string;
}

/** Feedback record capturing whether a retrieval was helpful. */
export interface RetrievalFeedback {
  readonly feedbackId: string;
  readonly timestamp: string;
  readonly querySummary: string;
  readonly retrievedMemoryId: string;
  readonly usedInResponse: boolean;
  readonly helpfulnessScore: number;
  readonly hallucinationDetected: boolean;
  readonly futureWeightAdjustment: number;
}
