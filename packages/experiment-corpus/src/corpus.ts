/**
 * Fixed replay corpus for substrate experiments.
 *
 * The corpus contains three semantic clusters of memories with planted
 * associative relationships, a range of signal profiles covering high/low
 * importance, novelty, contradiction, and tool usefulness, and a set of
 * retrieval queries with known ground-truth target memory IDs.
 *
 * All IDs are deterministic so that experiment runs can be compared across
 * T settings without confounding from random corpus variation. Embedding
 * vectors are synthetic 4-dimensional stubs — sufficient for in-memory
 * distance comparisons but not for production OpenSearch k-NN.
 */

import type { MemoryLink, MemoryReference, SemanticMemory } from "@cognitive-substrate/core-types";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Cluster definitions
// ---------------------------------------------------------------------------

/**
 * Cluster A — deployment reliability.
 * High-importance, frequently-retrieved, low-contradiction memories.
 * Expected to survive decay and dominate low-T retrieval.
 */
const CLUSTER_A_IDS = ["mem-a1", "mem-a2", "mem-a3", "mem-a4"] as const;

/**
 * Cluster B — novel experimental observations.
 * High-novelty, low-usage-frequency, moderate-importance memories.
 * Expected to surface more under high-T retrieval; at risk of decay under low-T.
 */
const CLUSTER_B_IDS = ["mem-b1", "mem-b2", "mem-b3"] as const;

/**
 * Cluster C — contradictory or low-value memories.
 * Low-importance, high-contradiction-risk memories.
 * Expected to be suppressed or retired across all T settings; useful as a
 * negative control — a T setting that retrieves these frequently is miscalibrated.
 */
const CLUSTER_C_IDS = ["mem-c1", "mem-c2"] as const;

export const ALL_MEMORY_IDS = [
  ...CLUSTER_A_IDS,
  ...CLUSTER_B_IDS,
  ...CLUSTER_C_IDS,
] as const;

export type CorpusMemoryId = (typeof ALL_MEMORY_IDS)[number];

// ---------------------------------------------------------------------------
// Memory records
// ---------------------------------------------------------------------------

/** Synthetic semantic memories representing the corpus. */
export const CORPUS_MEMORIES: ReadonlyArray<SemanticMemory> = [
  // Cluster A — deployment reliability
  {
    memoryId: "mem-a1",
    createdAt: "2026-01-01T00:00:00Z",
    summary: "Deployment rollback resolved elevated error rate within SLA.",
    generalization: "Rollback is a reliable recovery path for deployment-caused error spikes.",
    embedding: [0.9, 0.1, 0.1, 0.1],
    sourceEventIds: ["evt-a1-1", "evt-a1-2"],
    importanceScore: 0.85,
    stabilityScore: 0.8,
    contradictionScore: 0.05,
    semanticCluster: "cluster-a",
    usageFrequency: 0.7,
  },
  {
    memoryId: "mem-a2",
    createdAt: "2026-01-05T00:00:00Z",
    summary: "Canary deployment caught regression before full rollout.",
    generalization: "Canary stages reduce blast radius of regressions in production.",
    embedding: [0.85, 0.15, 0.1, 0.05],
    sourceEventIds: ["evt-a2-1"],
    importanceScore: 0.8,
    stabilityScore: 0.75,
    contradictionScore: 0.05,
    semanticCluster: "cluster-a",
    usageFrequency: 0.6,
  },
  {
    memoryId: "mem-a3",
    createdAt: "2026-01-10T00:00:00Z",
    summary: "Feature flag disabled problematic path without requiring redeployment.",
    generalization: "Feature flags decouple deployment from release and reduce rollback cost.",
    embedding: [0.8, 0.2, 0.1, 0.1],
    sourceEventIds: ["evt-a3-1", "evt-a3-2"],
    importanceScore: 0.75,
    stabilityScore: 0.8,
    contradictionScore: 0.0,
    semanticCluster: "cluster-a",
    usageFrequency: 0.5,
  },
  {
    memoryId: "mem-a4",
    createdAt: "2026-01-15T00:00:00Z",
    summary: "Health check endpoint surfaced degraded dependency before alert fired.",
    generalization: "Active health checks provide earlier signal than reactive alerting.",
    embedding: [0.75, 0.25, 0.05, 0.1],
    sourceEventIds: ["evt-a4-1"],
    importanceScore: 0.7,
    stabilityScore: 0.75,
    contradictionScore: 0.05,
    semanticCluster: "cluster-a",
    usageFrequency: 0.4,
  },

  // Cluster B — novel experimental observations
  {
    memoryId: "mem-b1",
    createdAt: "2026-02-01T00:00:00Z",
    summary: "Retrieval breadth increased when explorationFactor exceeded 0.7.",
    generalization: "High exploration temperature surfaces semantically distant memories.",
    embedding: [0.1, 0.9, 0.1, 0.1],
    sourceEventIds: ["evt-b1-1"],
    importanceScore: 0.6,
    stabilityScore: 0.5,
    contradictionScore: 0.1,
    semanticCluster: "cluster-b",
    usageFrequency: 0.1,
  },
  {
    memoryId: "mem-b2",
    createdAt: "2026-02-10T00:00:00Z",
    summary: "Novel log pattern preceded latency spike by 40 minutes; not previously indexed.",
    generalization: "Novel signal types may precede known failure modes with lead time.",
    embedding: [0.15, 0.85, 0.05, 0.1],
    sourceEventIds: ["evt-b2-1", "evt-b2-2"],
    importanceScore: 0.65,
    stabilityScore: 0.45,
    contradictionScore: 0.15,
    semanticCluster: "cluster-b",
    usageFrequency: 0.05,
  },
  {
    memoryId: "mem-b3",
    createdAt: "2026-02-20T00:00:00Z",
    summary: "Cross-cluster memory link traversal returned associated cause not in direct query results.",
    generalization: "Graph traversal over memory links recovers causally related episodes missed by flat k-NN.",
    embedding: [0.1, 0.8, 0.15, 0.1],
    sourceEventIds: ["evt-b3-1"],
    importanceScore: 0.55,
    stabilityScore: 0.4,
    contradictionScore: 0.1,
    semanticCluster: "cluster-b",
    usageFrequency: 0.05,
  },

  // Cluster C — contradictory / low-value
  {
    memoryId: "mem-c1",
    createdAt: "2026-03-01T00:00:00Z",
    summary: "Rollback was attempted but failed to restore service — contradicts mem-a1.",
    generalization: "Rollback is not always a reliable recovery path.",
    embedding: [0.5, 0.1, 0.9, 0.1],
    sourceEventIds: ["evt-c1-1"],
    importanceScore: 0.3,
    stabilityScore: 0.2,
    contradictionScore: 0.8,
    semanticCluster: "cluster-c",
    usageFrequency: 0.15,
  },
  {
    memoryId: "mem-c2",
    createdAt: "2026-03-10T00:00:00Z",
    summary: "Unrelated configuration change; no observable outcome.",
    generalization: "No generalization available.",
    embedding: [0.1, 0.1, 0.8, 0.9],
    sourceEventIds: ["evt-c2-1"],
    importanceScore: 0.15,
    stabilityScore: 0.3,
    contradictionScore: 0.2,
    semanticCluster: "cluster-c",
    usageFrequency: 0.05,
  },
];

// ---------------------------------------------------------------------------
// Associative links
// ---------------------------------------------------------------------------

/**
 * Planted memory graph edges. These represent the associative relationships
 * that graph-traversal retrieval (Experiment 1) should be able to exploit.
 */
export const CORPUS_LINKS: ReadonlyArray<MemoryLink> = [
  // Within cluster A — causal chain
  { linkId: "link-a1-a2", sourceMemoryId: "mem-a1", targetMemoryId: "mem-a2", relationshipType: "causal", strength: 0.8, createdAt: "2026-01-06T00:00:00Z" },
  { linkId: "link-a2-a3", sourceMemoryId: "mem-a2", targetMemoryId: "mem-a3", relationshipType: "causal", strength: 0.7, createdAt: "2026-01-11T00:00:00Z" },
  { linkId: "link-a1-a4", sourceMemoryId: "mem-a1", targetMemoryId: "mem-a4", relationshipType: "temporal", strength: 0.6, createdAt: "2026-01-16T00:00:00Z" },

  // Cross-cluster — B generalizes from A
  { linkId: "link-b3-a1", sourceMemoryId: "mem-b3", targetMemoryId: "mem-a1", relationshipType: "derived_from", strength: 0.65, createdAt: "2026-02-21T00:00:00Z" },
  { linkId: "link-b1-b2", sourceMemoryId: "mem-b1", targetMemoryId: "mem-b2", relationshipType: "semantic", strength: 0.75, createdAt: "2026-02-11T00:00:00Z" },

  // Cross-cluster — C contradicts A
  { linkId: "link-c1-a1", sourceMemoryId: "mem-c1", targetMemoryId: "mem-a1", relationshipType: "contradicts", strength: 0.85, createdAt: "2026-03-02T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Reinforcement signals
// ---------------------------------------------------------------------------

/**
 * One reinforcement turn in the replay sequence. `memoryId` identifies
 * which memory is being reinforced; `signal` is the scoring input.
 */
export interface CorpusTurn {
  readonly turnId: string;
  readonly memoryId: CorpusMemoryId;
  readonly signal: ReinforcementSignal;
  /**
   * Expected retrieval targets for the query issued this turn.
   * Ground truth for hit-rate evaluation.
   */
  readonly groundTruthTargets: ReadonlyArray<CorpusMemoryId>;
}

/**
 * 20-turn fixed replay sequence covering:
 *   - High-reinforcement turns anchoring cluster A
 *   - Low-T-friendly turns (familiar, high-importance)
 *   - High-T-revealing turns (novel cluster B memories that only surface under exploration)
 *   - Contradiction turns that should not reinforce cluster C
 */
export const CORPUS_TURNS: ReadonlyArray<CorpusTurn> = [
  // Turns 1–6: cluster A — high importance, high policy alignment
  { turnId: "turn-01", memoryId: "mem-a1", groundTruthTargets: ["mem-a1", "mem-a2"], signal: { importance: 0.85, usageFrequency: 0.7, goalRelevance: 0.8, novelty: 0.2, predictionAccuracy: 0.9, emotionalWeight: 0.6, contradictionRisk: 0.05, policyAlignment: 0.8, toolUsefulness: 0.7 } },
  { turnId: "turn-02", memoryId: "mem-a2", groundTruthTargets: ["mem-a2", "mem-a1"], signal: { importance: 0.8, usageFrequency: 0.6, goalRelevance: 0.75, novelty: 0.25, predictionAccuracy: 0.85, emotionalWeight: 0.5, contradictionRisk: 0.05, policyAlignment: 0.75 } },
  { turnId: "turn-03", memoryId: "mem-a3", groundTruthTargets: ["mem-a3", "mem-a2"], signal: { importance: 0.75, usageFrequency: 0.5, goalRelevance: 0.7, novelty: 0.3, predictionAccuracy: 0.8, emotionalWeight: 0.45, contradictionRisk: 0.0, policyAlignment: 0.75, toolUsefulness: 0.6 } },
  { turnId: "turn-04", memoryId: "mem-a1", groundTruthTargets: ["mem-a1", "mem-a4"], signal: { importance: 0.85, usageFrequency: 0.75, goalRelevance: 0.8, novelty: 0.15, predictionAccuracy: 0.9, emotionalWeight: 0.65, contradictionRisk: 0.05, policyAlignment: 0.8 } },
  { turnId: "turn-05", memoryId: "mem-a4", groundTruthTargets: ["mem-a4", "mem-a1"], signal: { importance: 0.7, usageFrequency: 0.4, goalRelevance: 0.65, novelty: 0.35, predictionAccuracy: 0.75, emotionalWeight: 0.4, contradictionRisk: 0.05, policyAlignment: 0.7, toolUsefulness: 0.8 } },
  { turnId: "turn-06", memoryId: "mem-a2", groundTruthTargets: ["mem-a2", "mem-a3"], signal: { importance: 0.8, usageFrequency: 0.65, goalRelevance: 0.75, novelty: 0.2, predictionAccuracy: 0.85, emotionalWeight: 0.55, contradictionRisk: 0.0, policyAlignment: 0.75 } },

  // Turns 7–10: cluster B — novel, low-usage; only surface under high-T
  { turnId: "turn-07", memoryId: "mem-b1", groundTruthTargets: ["mem-b1", "mem-b2"], signal: { importance: 0.6, usageFrequency: 0.1, goalRelevance: 0.5, novelty: 0.85, predictionAccuracy: 0.6, emotionalWeight: 0.5, contradictionRisk: 0.1, policyAlignment: 0.5, toolUsefulness: 0.3 } },
  { turnId: "turn-08", memoryId: "mem-b2", groundTruthTargets: ["mem-b2", "mem-b1"], signal: { importance: 0.65, usageFrequency: 0.05, goalRelevance: 0.55, novelty: 0.9, predictionAccuracy: 0.55, emotionalWeight: 0.6, contradictionRisk: 0.15, policyAlignment: 0.45 } },
  { turnId: "turn-09", memoryId: "mem-b3", groundTruthTargets: ["mem-b3", "mem-a1"], signal: { importance: 0.55, usageFrequency: 0.05, goalRelevance: 0.5, novelty: 0.8, predictionAccuracy: 0.5, emotionalWeight: 0.45, contradictionRisk: 0.1, policyAlignment: 0.4, toolUsefulness: 0.4 } },
  { turnId: "turn-10", memoryId: "mem-b1", groundTruthTargets: ["mem-b1", "mem-b3"], signal: { importance: 0.6, usageFrequency: 0.1, goalRelevance: 0.5, novelty: 0.85, predictionAccuracy: 0.6, emotionalWeight: 0.5, contradictionRisk: 0.1, policyAlignment: 0.5 } },

  // Turns 11–13: cluster C — should not reinforce; contradiction risk high
  { turnId: "turn-11", memoryId: "mem-c1", groundTruthTargets: ["mem-a1"], signal: { importance: 0.3, usageFrequency: 0.15, goalRelevance: 0.2, novelty: 0.4, predictionAccuracy: 0.3, emotionalWeight: 0.3, contradictionRisk: 0.8, policyAlignment: 0.2, toolUsefulness: 0.2 } },
  { turnId: "turn-12", memoryId: "mem-c2", groundTruthTargets: [], signal: { importance: 0.15, usageFrequency: 0.05, goalRelevance: 0.1, novelty: 0.2, predictionAccuracy: 0.2, emotionalWeight: 0.1, contradictionRisk: 0.2, policyAlignment: 0.15 } },
  { turnId: "turn-13", memoryId: "mem-c1", groundTruthTargets: ["mem-a1"], signal: { importance: 0.3, usageFrequency: 0.15, goalRelevance: 0.2, novelty: 0.35, predictionAccuracy: 0.25, emotionalWeight: 0.25, contradictionRisk: 0.8, policyAlignment: 0.2 } },

  // Turns 14–17: mixed — cluster A with moderate novelty; tests mid-T behaviour
  { turnId: "turn-14", memoryId: "mem-a3", groundTruthTargets: ["mem-a3", "mem-b1"], signal: { importance: 0.75, usageFrequency: 0.55, goalRelevance: 0.7, novelty: 0.55, predictionAccuracy: 0.8, emotionalWeight: 0.5, contradictionRisk: 0.0, policyAlignment: 0.7, toolUsefulness: 0.65 } },
  { turnId: "turn-15", memoryId: "mem-b2", groundTruthTargets: ["mem-b2", "mem-a4"], signal: { importance: 0.65, usageFrequency: 0.1, goalRelevance: 0.6, novelty: 0.75, predictionAccuracy: 0.6, emotionalWeight: 0.55, contradictionRisk: 0.1, policyAlignment: 0.5 } },
  { turnId: "turn-16", memoryId: "mem-a4", groundTruthTargets: ["mem-a4", "mem-a1"], signal: { importance: 0.7, usageFrequency: 0.45, goalRelevance: 0.65, novelty: 0.4, predictionAccuracy: 0.75, emotionalWeight: 0.45, contradictionRisk: 0.05, policyAlignment: 0.7, toolUsefulness: 0.7 } },
  { turnId: "turn-17", memoryId: "mem-a1", groundTruthTargets: ["mem-a1", "mem-b3"], signal: { importance: 0.85, usageFrequency: 0.8, goalRelevance: 0.8, novelty: 0.3, predictionAccuracy: 0.9, emotionalWeight: 0.65, contradictionRisk: 0.05, policyAlignment: 0.8 } },

  // Turns 18–20: cluster B follow-up — tests whether high-T run built retrieval path to B
  { turnId: "turn-18", memoryId: "mem-b3", groundTruthTargets: ["mem-b3", "mem-b1", "mem-a1"], signal: { importance: 0.6, usageFrequency: 0.1, goalRelevance: 0.55, novelty: 0.8, predictionAccuracy: 0.55, emotionalWeight: 0.5, contradictionRisk: 0.1, policyAlignment: 0.45, toolUsefulness: 0.35 } },
  { turnId: "turn-19", memoryId: "mem-b1", groundTruthTargets: ["mem-b1", "mem-b2", "mem-b3"], signal: { importance: 0.6, usageFrequency: 0.15, goalRelevance: 0.5, novelty: 0.85, predictionAccuracy: 0.6, emotionalWeight: 0.5, contradictionRisk: 0.1, policyAlignment: 0.5 } },
  { turnId: "turn-20", memoryId: "mem-a2", groundTruthTargets: ["mem-a2", "mem-a1", "mem-b3"], signal: { importance: 0.8, usageFrequency: 0.7, goalRelevance: 0.75, novelty: 0.45, predictionAccuracy: 0.85, emotionalWeight: 0.6, contradictionRisk: 0.0, policyAlignment: 0.75, toolUsefulness: 0.6 } },
];

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Returns a synthetic MemoryReference for a corpus memory ID.
 * Useful for stubbing retrieval results in harness tests.
 */
export function memoryReferenceFor(id: CorpusMemoryId): MemoryReference {
  const memory = CORPUS_MEMORIES.find((m) => m.memoryId === id);
  if (!memory) throw new Error(`Unknown corpus memory ID: ${id}`);
  return {
    memoryId: memory.memoryId,
    index: "memory_semantic",
    score: memory.importanceScore,
    summary: memory.summary,
    importanceScore: memory.importanceScore,
    lastRetrieved: memory.createdAt,
  };
}

/** Returns all memories belonging to a named cluster. */
export function clusterMemories(cluster: "a" | "b" | "c"): ReadonlyArray<SemanticMemory> {
  return CORPUS_MEMORIES.filter((m) => m.semanticCluster === `cluster-${cluster}`);
}

/** Returns all links where the given memory ID is the source. */
export function outboundLinks(memoryId: CorpusMemoryId): ReadonlyArray<MemoryLink> {
  return CORPUS_LINKS.filter((l) => l.sourceMemoryId === memoryId);
}

/** Returns all links where the given memory ID is the target. */
export function inboundLinks(memoryId: CorpusMemoryId): ReadonlyArray<MemoryLink> {
  return CORPUS_LINKS.filter((l) => l.targetMemoryId === memoryId);
}
