import type { PolicyState } from "@cognitive-substrate/core-types";

export const DEFAULT_POLICY_VERSION = "policy-v1";

export function createDefaultPolicyState(timestamp: string = new Date().toISOString()): PolicyState {
  return {
    version: DEFAULT_POLICY_VERSION,
    timestamp,
    retrievalBias: 0.5,
    toolBias: 0.5,
    riskTolerance: 0.5,
    memoryTrust: 0.5,
    explorationFactor: 0.5,
    goalPersistence: 0.5,
    workingMemoryDecayRate: 0.5,
  };
}
