import type { Client } from "@opensearch-project/opensearch";
import { updateDocument } from "@cognitive-substrate/memory-opensearch";
import { scoreReinforcement } from "./scoring.js";
import type {
  IdentityImpactSignal,
  ReinforcementInput,
  ReinforcementUpdate,
} from "./types.js";

export interface ReinforcementEngineConfig {
  readonly openSearch?: Client;
  readonly updateMemory?: typeof updateDocument;
}

export class ReinforcementEngine {
  private readonly openSearch: Client | undefined;
  private readonly updateMemory: typeof updateDocument;

  constructor(config: ReinforcementEngineConfig = {}) {
    this.openSearch = config.openSearch;
    this.updateMemory = config.updateMemory ?? updateDocument;
  }

  async evaluate(input: ReinforcementInput): Promise<ReinforcementUpdate> {
    const result = scoreReinforcement(input.signal);
    if (this.openSearch) {
      await this.updateMemory(this.openSearch, input.memoryIndex, input.memoryId, {
        retrieval_priority: result.retrievalPriority,
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
      identityImpact: identityImpact(input.memoryId, result.identityImpact),
    };
  }
}

function identityImpact(
  sourceMemoryId: string,
  impact: number,
): IdentityImpactSignal {
  return {
    sourceMemoryId,
    curiosityDelta: Math.max(0, impact),
    cautionDelta: Math.max(0, -impact),
    stabilityDelta: -Math.abs(impact) * 0.25,
  };
}
