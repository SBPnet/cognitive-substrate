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
 *
 * Hebbian compounding (Experiment 10):
 * When `countBonus > 0`, the engine reads and increments `reinforcement_count`
 * on each evaluation, then adds `countBonus × log2(1 + count)` to the final
 * retrieval_priority. This shifts the fixed point upward with each evaluation —
 * memories that are consistently positively reinforced compound away from those
 * receiving weak or contradictory signal, mirroring biological long-term
 * potentiation. The log2 curve prevents unbounded growth.
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
  /**
   * Hebbian log-count bonus coefficient. When > 0, the engine reads and
   * increments `reinforcement_count` per evaluation and adds
   * `countBonus × log2(1 + count)` to the final retrieval_priority.
   * Typical range: 0.02–0.05. At 0.03 a memory reaches +0.15 after ~30
   * evaluations and +0.25 after ~200, approaching but never exceeding 1.
   */
  readonly countBonus?: number;
}

interface PriorDoc extends Record<string, unknown> {
  readonly retrieval_priority?: number;
  readonly reinforcement_count?: number;
}

export class ReinforcementEngine {
  private readonly openSearch: Client | undefined;
  private readonly updateMemory: typeof updateDocument;
  private readonly priorWeight: number;
  private readonly countBonus: number;

  constructor(config: ReinforcementEngineConfig = {}) {
    this.openSearch = config.openSearch;
    this.updateMemory = config.updateMemory ?? updateDocument;
    this.priorWeight = config.priorWeight ?? 0;
    this.countBonus = config.countBonus ?? 0;
  }

  /**
   * Runs scoring for one reinforcement input. When a client is configured,
   * the memory document is updated in place with the new retrieval priority,
   * decay factor, reinforcement score, and (when countBonus > 0)
   * reinforcement_count so that subsequent retrieval passes see the change.
   */
  async evaluate(input: ReinforcementInput): Promise<ReinforcementUpdate> {
    const result = scoreReinforcement(input.signal);

    if (this.openSearch) {
      let finalRp = result.retrievalPriority;
      let newCount: number | undefined;

      if (this.priorWeight > 0 || this.countBonus > 0) {
        const prior = await getDocument<PriorDoc>(this.openSearch, input.memoryIndex, input.memoryId);

        if (this.priorWeight > 0) {
          const priorRp = prior?.retrieval_priority ?? result.retrievalPriority;
          finalRp = priorRp * this.priorWeight + result.retrievalPriority * (1 - this.priorWeight);
        }

        if (this.countBonus > 0) {
          newCount = (prior?.reinforcement_count ?? 0) + 1;
          // Gate the bonus on reinforcement quality so that low-signal memories
          // (high contradictionRisk, low importance) don't accumulate strength
          // through count alone. Exp 10 found that bare log(count) lifted
          // mem-c1 above its baseline despite weak signal.
          finalRp += this.countBonus * Math.log2(1 + newCount) * result.reinforcement;
        }

        finalRp = Math.max(0, Math.min(1, finalRp));
      }

      await this.updateMemory(this.openSearch, input.memoryIndex, input.memoryId, {
        retrieval_priority: finalRp,
        decay_factor: result.decayAdjustment,
        reinforcement_score: result.reinforcement,
        ...(newCount !== undefined ? { reinforcement_count: newCount } : {}),
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
