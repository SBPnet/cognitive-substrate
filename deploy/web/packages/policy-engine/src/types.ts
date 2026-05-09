import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";

export type PolicyVectorKey = Exclude<keyof PolicyState, "version" | "timestamp">;

export type PolicyDelta = Partial<Record<PolicyVectorKey, number>>;

export interface PolicyEvaluationInput {
  readonly sourceExperienceId: string;
  readonly sourceClusterId?: string;
  readonly rewardDelta: number;
  readonly confidence?: number;
  readonly contradictionRisk?: number;
  readonly memoryUsefulness?: number;
  readonly toolUsefulness?: number;
  readonly goalProgress?: number;
}

export interface PolicyUpdateResult {
  readonly previous: PolicyState;
  readonly next: PolicyState;
  readonly event: PolicyUpdateEvent;
}

export interface PolicySnapshotRecord extends Record<string, unknown> {
  readonly policy_id: string;
  readonly timestamp: string;
  readonly retrieval_bias: number;
  readonly tool_bias: number;
  readonly risk_tolerance: number;
  readonly memory_trust: number;
  readonly exploration_factor: number;
  readonly goal_persistence: number;
  readonly working_memory_decay_rate: number;
  readonly source_experience_id?: string;
  readonly source_cluster_id?: string;
  readonly reward_delta?: number;
}

export interface PolicyStore {
  getCurrent(): Promise<PolicyState | undefined>;
  saveSnapshot(
    state: PolicyState,
    event?: PolicyUpdateEvent,
  ): Promise<void>;
}
