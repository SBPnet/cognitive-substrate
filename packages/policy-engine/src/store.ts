/**
 * Reference PolicyStore implementations.
 *
 * `InMemoryPolicyStore` is the canonical store for unit tests and short-lived
 * sessions: it keeps the latest snapshot plus an in-memory append log of
 * historical snapshots, but loses data on process exit.
 *
 * `OpenSearchPolicyStore` mirrors snapshots into the `policy_state` index so
 * that the workbench, audit pipeline, and offline analyses can see the full
 * drift trajectory. It composes with a fallback store for hot reads, since
 * OpenSearch is treated as durable storage rather than a low-latency cache.
 */

import type { Client } from "@opensearch-project/opensearch";
import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import { createDefaultPolicyState } from "./defaults.js";
import type { PolicySnapshotRecord, PolicyStore } from "./types.js";

/**
 * Process-local PolicyStore. Snapshots are retained in an append-only list
 * for inspection via `listSnapshots()`. Suitable for tests and ephemeral
 * orchestrator processes that do not require durable policy history.
 */
export class InMemoryPolicyStore implements PolicyStore {
  private current: PolicyState | undefined;
  private readonly snapshots: PolicySnapshotRecord[] = [];

  constructor(initialState: PolicyState = createDefaultPolicyState()) {
    this.current = initialState;
  }

  async getCurrent(): Promise<PolicyState | undefined> {
    return this.current;
  }

  async saveSnapshot(
    state: PolicyState,
    event?: PolicyUpdateEvent,
  ): Promise<void> {
    this.current = state;
    this.snapshots.push(toSnapshotRecord(state, event));
  }

  /** Returns the in-memory history. The array is readonly to callers. */
  listSnapshots(): ReadonlyArray<PolicySnapshotRecord> {
    return this.snapshots;
  }
}

export interface OpenSearchPolicyStoreConfig {
  readonly openSearch: Client;
  /**
   * Hot-read store. Defaults to a fresh `InMemoryPolicyStore` so that
   * `getCurrent` does not hit OpenSearch on every call.
   */
  readonly fallback?: PolicyStore;
  /** Override hook for tests; defaults to the production `indexDocument`. */
  readonly indexSnapshot?: typeof indexDocument;
}

/**
 * Durable PolicyStore that writes each snapshot to the `policy_state`
 * OpenSearch index using the version label as the document ID, so that an
 * upsert overwrites the previous record for that version while preserving
 * the audit trail in the configured fallback store.
 */
export class OpenSearchPolicyStore implements PolicyStore {
  private readonly openSearch: Client;
  private readonly fallback: PolicyStore;
  private readonly indexSnapshot: typeof indexDocument;

  constructor(config: OpenSearchPolicyStoreConfig) {
    this.openSearch = config.openSearch;
    this.fallback = config.fallback ?? new InMemoryPolicyStore();
    this.indexSnapshot = config.indexSnapshot ?? indexDocument;
  }

  async getCurrent(): Promise<PolicyState | undefined> {
    return this.fallback.getCurrent();
  }

  async saveSnapshot(
    state: PolicyState,
    event?: PolicyUpdateEvent,
  ): Promise<void> {
    await this.fallback.saveSnapshot(state, event);
    const record = toSnapshotRecord(state, event);
    await this.indexSnapshot(this.openSearch, "policy_state", state.version, record);
  }
}

/**
 * Flattens a PolicyState plus optional audit event into the snake_case
 * record shape stored in the `policy_state` index.
 */
export function toSnapshotRecord(
  state: PolicyState,
  event?: PolicyUpdateEvent,
): PolicySnapshotRecord {
  return {
    policy_id: state.version,
    timestamp: state.timestamp,
    retrieval_bias: state.retrievalBias,
    tool_bias: state.toolBias,
    risk_tolerance: state.riskTolerance,
    memory_trust: state.memoryTrust,
    exploration_factor: state.explorationFactor,
    goal_persistence: state.goalPersistence,
    working_memory_decay_rate: state.workingMemoryDecayRate,
    ...(event
      ? {
          source_experience_id: event.sourceExperienceId,
          ...(event.sourceClusterId
            ? { source_cluster_id: event.sourceClusterId }
            : {}),
          reward_delta: event.rewardDelta,
        }
      : {}),
  };
}
