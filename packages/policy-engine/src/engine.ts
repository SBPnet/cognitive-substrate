/**
 * Coordinator for the closed-loop policy update.
 *
 * `PolicyEngine` reads the current snapshot from a `PolicyStore`, computes a
 * bounded delta from a `PolicyEvaluationInput`, advances the version label,
 * persists the new snapshot together with the audit `PolicyUpdateEvent`,
 * and returns a `PolicyUpdateResult` for downstream consumers (Kafka emit,
 * trace annotation, etc.). The engine does not own a Kafka producer; emit
 * is the caller's responsibility so that batching and trace context stay
 * external.
 */

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
  /** Prefix for synthesised version strings. Defaults to `policy`. */
  readonly versionPrefix?: string;
}

/**
 * Stateless wrapper around a PolicyStore. The engine itself holds no state;
 * all durability lives in the configured store.
 */
export class PolicyEngine {
  private readonly store: PolicyStore;
  private readonly versionPrefix: string;

  constructor(config: PolicyEngineConfig) {
    this.store = config.store;
    this.versionPrefix = config.versionPrefix ?? "policy";
  }

  /**
   * Returns the current policy snapshot, falling back to the neutral
   * default when the store has no record yet.
   */
  async getCurrentPolicy(): Promise<PolicyState> {
    return (await this.store.getCurrent()) ?? createDefaultPolicyState();
  }

  /**
   * Applies one reinforcement evaluation: computes the delta, advances the
   * version, persists the snapshot, and returns the previous/next pair plus
   * the audit event that callers should publish to Kafka.
   */
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

  /**
   * Increments the trailing version number on the current label, or starts
   * at `-v1` when the label has no numeric suffix. The prefix is treated
   * as opaque so that callers can use any label scheme as long as the
   * trailing digits are monotonic.
   */
  private nextVersion(currentVersion: string): string {
    const suffix = currentVersion.match(/(\d+)$/)?.[1];
    const nextNumber = suffix ? Number.parseInt(suffix, 10) + 1 : 1;
    return `${this.versionPrefix}-v${nextNumber}`;
  }
}
