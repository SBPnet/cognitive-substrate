/**
 * Reinforcement-engine orchestrator.
 *
 * `ReinforcementEngine.evaluate` runs the scoring function, optionally
 * persists the new retrieval priority and decay factor on the underlying
 * memory document, and returns a `ReinforcementUpdate` containing both the
 * policy vote and the identity-impact signal for downstream fan-out.
 *
 * The engine intentionally does not own a Kafka producer: callers decide
 * whether the policy vote is sent to the policy worker synchronously or
 * batched onto the `policy.evaluation` topic.
 */

import type { Client } from "@opensearch-project/opensearch";
import { getDocument, updateDocument } from "@cognitive-substrate/memory-opensearch";
import { scoreReinforcement } from "./scoring.js";
import type {
  IdentityImpactSignal,
  ReinforcementInput,
  ReinforcementUpdate,
} from "./types.js";

export interface ReinforcementEngineConfig {
  /** Optional OpenSearch client. When omitted, scoring runs without persistence. */
  readonly openSearch?: Client;
  /** Override hook for tests; defaults to the production `updateDocument`. */
  readonly updateMemory?: typeof updateDocument;
  /**
   * Exponential moving average weight applied to the prior retrieval_priority
   * when blending with the newly computed value. 0 = stateless (Exp 7
   * behaviour), 0.3 = mild compounding (default), 1 = never update.
   *
   * Formula: finalRp = prior × priorWeight + newRp × (1 - priorWeight)
   *
   * This implements Hebbian-style memory strengthening: each positive
   * reinforcement nudges retrieval_priority upward rather than resetting it,
   * so trusted memories compound away from memories that receive weak signal.
   * Contradiction-risk memories still decay because their newRp is consistently
   * low regardless of how large priorWeight is.
   */
  readonly priorWeight?: number;
}

interface PriorDoc extends Record<string, unknown> {
  readonly retrieval_priority?: number;
}

export class ReinforcementEngine {
  private readonly openSearch: Client | undefined;
  private readonly updateMemory: typeof updateDocument;
  private readonly priorWeight: number;

  constructor(config: ReinforcementEngineConfig = {}) {
    this.openSearch = config.openSearch;
    this.updateMemory = config.updateMemory ?? updateDocument;
    this.priorWeight = config.priorWeight ?? 0;
  }

  /**
   * Runs scoring for one reinforcement input. When a client is configured,
   * the memory document is updated in place with the new retrieval priority,
   * decay factor, and reinforcement score so that subsequent retrieval
   * passes see the change immediately.
   *
   * When `priorWeight > 0`, the current retrieval_priority is read from
   * OpenSearch before scoring and blended as an EMA prior, producing
   * compounding reinforcement rather than stateless replacement.
   */
  async evaluate(input: ReinforcementInput): Promise<ReinforcementUpdate> {
    const result = scoreReinforcement(input.signal);

    if (this.openSearch) {
      let finalRp = result.retrievalPriority;
      if (this.priorWeight > 0) {
        const prior = await getDocument<PriorDoc>(this.openSearch, input.memoryIndex, input.memoryId);
        const priorRp = prior?.retrieval_priority ?? result.retrievalPriority;
        finalRp = Math.max(0, Math.min(1, priorRp * this.priorWeight + result.retrievalPriority * (1 - this.priorWeight)));
      }
      await this.updateMemory(this.openSearch, input.memoryIndex, input.memoryId, {
        retrieval_priority: finalRp,
        decay_factor: result.decayAdjustment,
        reinforcement_score: result.reinforcement,
      });
    }

    return {
      memoryId: input.memoryId,
      memoryIndex: input.memoryIndex,
      result,
      policyVote: {
        sourceExperienceId: input.memoryId,
        rewardDelta: result.policyDelta,
        confidence: result.reinforcement,
        contradictionRisk: input.signal.contradictionRisk,
        memoryUsefulness: result.retrievalPriority,
        goalProgress: input.signal.goalRelevance,
      },
      identityImpact: identityImpact(input.memoryId, result.identityImpact, result.toolDependenceDelta),
    };
  }
}

/**
 * Splits the scalar `identityImpact` from `scoreReinforcement` into the
 * three identity dimensions consumed by the narrative engine. Positive
 * impact accumulates curiosity, negative impact accumulates caution,
 * and the magnitude reduces stability proportionally.
 */
function identityImpact(
  sourceMemoryId: string,
  impact: number,
  toolDependenceDelta: number,
): IdentityImpactSignal {
  return {
    sourceMemoryId,
    curiosityDelta: Math.max(0, impact),
    cautionDelta: Math.max(0, -impact),
    stabilityDelta: -Math.abs(impact) * 0.25,
    toolDependenceDelta,
  };
}
