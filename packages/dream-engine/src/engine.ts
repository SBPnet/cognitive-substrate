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
