/**
 * Initial policy values used when no prior snapshot exists.
 *
 * The default vector is deliberately neutral (every dimension at 0.5) so that
 * a freshly bootstrapped system does not bias retrieval, tool use, risk, or
 * exploration in any direction. Reinforcement is responsible for moving the
 * state away from this midpoint.
 */

import type { PolicyState } from "@cognitive-substrate/core-types";

/** Version label assigned to the very first policy snapshot. */
export const DEFAULT_POLICY_VERSION = "policy-v1";

/**
 * Constructs a fresh PolicyState with all dimensions set to 0.5.
 * The timestamp argument is exposed for deterministic test fixtures.
 */
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
