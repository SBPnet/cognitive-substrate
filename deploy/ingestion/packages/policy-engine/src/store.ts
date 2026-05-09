import type { Client } from "@opensearch-project/opensearch";
import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import { createDefaultPolicyState } from "./defaults.js";
import type { PolicySnapshotRecord, PolicyStore } from "./types.js";

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

  listSnapshots(): ReadonlyArray<PolicySnapshotRecord> {
    return this.snapshots;
  }
}

export interface OpenSearchPolicyStoreConfig {
  readonly openSearch: Client;
  readonly fallback?: PolicyStore;
  readonly indexSnapshot?: typeof indexDocument;
}

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
