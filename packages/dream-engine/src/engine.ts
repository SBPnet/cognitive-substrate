/**
 * Dream / offline replay engine.
 *
 * `DreamEngine.runCycle` pairs adjacent memories from the input list and
 * synthesises a scenario for each pair. The current pairing strategy is
 * deterministic (consecutive pairs); future revisions are expected to
 * pair by semantic distance or contradiction pressure. Each scenario
 * emits a synthetic ExperienceEvent tagged with `dream` and
 * `synthetic-replay` so that downstream consumers can filter dream-origin
 * events out of episodic statistics.
 */

import { randomUUID } from "node:crypto";
import type { ExperienceEvent, SemanticMemory } from "@cognitive-substrate/core-types";
import type { DreamCycleResult, DreamInput, DreamScenario } from "./types.js";

export class DreamEngine {
  runCycle(input: DreamInput): DreamCycleResult {
    const pairs = pairMemories(input.memories).slice(0, input.maxScenarios ?? 5);
    const scenarios = pairs.map(([left, right]) => synthesizeScenario(left, right));
    return {
      scenarios,
      recombinedAbstractions: pairs.map(([left, right]) => `${left.generalization} ${right.generalization}`),
      stressFailures: scenarios
        .filter((scenario) => scenario.stressScore > 0.7)
        .map((scenario) => scenario.scenarioId),
    };
  }
}

/**
 * Builds one scenario from a pair of memories. `adversarialPressure` is
 * the average contradiction score of the inputs; `stressScore` blends
 * that with the inverse of the lower stability score so that brittle
 * memories (low stability) raise the stress signal even when their
 * contradiction signal is moderate.
 */
function synthesizeScenario(left: SemanticMemory, right: SemanticMemory): DreamScenario {
  const adversarialPressure = clamp((left.contradictionScore + right.contradictionScore) / 2);
  const stressScore = clamp(adversarialPressure * 0.6 + (1 - Math.min(left.stabilityScore, right.stabilityScore)) * 0.4);
  return {
    scenarioId: randomUUID(),
    sourceMemoryIds: [left.memoryId, right.memoryId],
    syntheticEvent: syntheticExperience(left, right, stressScore),
    adversarialPressure,
    stressScore,
  };
}

/**
 * Materialises the synthetic ExperienceEvent. The embedding falls back
 * from `left` to `right` so that downstream k-NN lookups still receive a
 * non-empty vector when only one source memory has been embedded.
 */
function syntheticExperience(left: SemanticMemory, right: SemanticMemory, stressScore: number): ExperienceEvent {
  return {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "system_event",
    context: {
      sessionId: "dream-cycle",
      traceId: randomUUID(),
    },
    input: {
      text: `Synthetic replay combining ${left.summary} with ${right.summary}`,
      embedding: left.embedding.length > 0 ? left.embedding : right.embedding,
      structured: {
        sourceMemoryIds: [left.memoryId, right.memoryId],
        stressScore,
      },
    },
    importanceScore: stressScore,
    tags: ["dream", "synthetic-replay"],
  };
}

/**
 * Returns adjacent pairs from the source list. Trailing memories without
 * a partner are dropped; this is a deliberate trade-off for simplicity
 * and may be revisited once richer pairing strategies land.
 */
function pairMemories(memories: ReadonlyArray<SemanticMemory>): ReadonlyArray<readonly [SemanticMemory, SemanticMemory]> {
  const pairs: Array<readonly [SemanticMemory, SemanticMemory]> = [];
  for (let index = 0; index < memories.length - 1; index += 2) {
    const left = memories[index];
    const right = memories[index + 1];
    if (left && right) pairs.push([left, right]);
  }
  return pairs;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
