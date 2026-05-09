import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";
import { createDefaultPolicyState } from "./defaults.js";
import { applyPolicyDelta, computePolicyDelta } from "./drift.js";
import type {
  PolicyEvaluationInput,
  PolicyStore,
  PolicyUpdateResult,
} from "./types.js";

export interface PolicyEngineConfig {
  readonly store: PolicyStore;
  readonly versionPrefix?: string;
}

export class PolicyEngine {
  private readonly store: PolicyStore;
  private readonly versionPrefix: string;

  constructor(config: PolicyEngineConfig) {
    this.store = config.store;
    this.versionPrefix = config.versionPrefix ?? "policy";
  }

  async getCurrentPolicy(): Promise<PolicyState> {
    return (await this.store.getCurrent()) ?? createDefaultPolicyState();
  }

  async applyEvaluation(
    input: PolicyEvaluationInput,
  ): Promise<PolicyUpdateResult> {
    const previous = await this.getCurrentPolicy();
    const delta = computePolicyDelta(input);
    const next = applyPolicyDelta(
      previous,
      delta,
      this.nextVersion(previous.version),
    );

    const event: PolicyUpdateEvent = {
      policyId: next.version,
      timestamp: next.timestamp,
      previousVersion: previous.version,
      nextVersion: next.version,
      delta,
      rewardDelta: input.rewardDelta,
      sourceExperienceId: input.sourceExperienceId,
      ...(input.sourceClusterId ? { sourceClusterId: input.sourceClusterId } : {}),
    };

    await this.store.saveSnapshot(next, event);
    return { previous, next, event };
  }

  private nextVersion(currentVersion: string): string {
    const suffix = currentVersion.match(/(\d+)$/)?.[1];
    const nextNumber = suffix ? Number.parseInt(suffix, 10) + 1 : 1;
    return `${this.versionPrefix}-v${nextNumber}`;
  }
}
