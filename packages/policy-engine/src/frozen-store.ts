/**
 * FrozenPolicyStore — a PolicyStore whose state cannot advance.
 *
 * `saveSnapshot` is a deliberate no-op: any delta applied through a
 * `PolicyEngine` backed by this store is computed and returned to the
 * caller but never persisted. The policy vector remains at the value
 * supplied at construction for the lifetime of the store.
 *
 * Intended for experiment harnesses that need a fixed exploration
 * temperature (T) across an entire run without disabling the engine's
 * scoring or delta computation paths.
 */

import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";
import { createDefaultPolicyState } from "./defaults.js";
import type { PolicyStore } from "./types.js";

export class FrozenPolicyStore implements PolicyStore {
  private readonly state: PolicyState;

  constructor(initialState: PolicyState = createDefaultPolicyState()) {
    this.state = initialState;
  }

  async getCurrent(): Promise<PolicyState> {
    return this.state;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async saveSnapshot(_state: PolicyState, _event?: PolicyUpdateEvent): Promise<void> {
    // intentional no-op — policy is frozen for the duration of the experiment
  }
}
