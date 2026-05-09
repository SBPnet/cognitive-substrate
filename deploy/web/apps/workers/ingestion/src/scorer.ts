/**
 * Initial importance scorer for raw experience events.
 *
 * The importance score determines retrieval priority within OpenSearch and
 * influences the reinforcement engine's survival calculation. At ingestion
 * time, only heuristic signals are available; the consolidation engine will
 * refine scores during the offline replay cycle.
 *
 * Score range: [0, 1].
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";

export interface ScoringWeights {
  /** Weight given to non-routine event types (tool results, observations). */
  eventTypeWeight: number;
  /** Weight given to a non-empty tag list. */
  tagsWeight: number;
  /** Weight given to a non-empty action block. */
  actionWeight: number;
  /** Weight given to a successful result. */
  successWeight: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  eventTypeWeight: 0.3,
  tagsWeight: 0.2,
  actionWeight: 0.2,
  successWeight: 0.3,
};

/**
 * Computes a heuristic importance score for a newly ingested experience event.
 * All constituent factors are normalized and summed against the weight vector.
 */
export function scoreImportance(
  event: Omit<ExperienceEvent, "importanceScore" | "objectStorageKey">,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const nonRoutineType =
    event.type !== "user_input" && event.type !== "system_event" ? 1.0 : 0.3;

  const hasAction = event.action ? 1.0 : 0.0;
  const hasTags = event.tags.length > 0 ? 1.0 : 0.0;
  const success = event.result?.success === true ? 1.0 : event.result?.success === false ? 0.1 : 0.5;

  const score =
    nonRoutineType * weights.eventTypeWeight +
    hasTags * weights.tagsWeight +
    hasAction * weights.actionWeight +
    success * weights.successWeight;

  return Math.max(0, Math.min(1, score));
}
