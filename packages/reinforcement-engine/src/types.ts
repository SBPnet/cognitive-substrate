/**
 * Reinforcement-engine type surface.
 *
 * The reinforcement engine takes a `ReinforcementSignal` from the core
 * types and returns three coupled outputs:
 *
 *   1. A `ReinforcementResult` (defined in core-types) that updates the
 *      memory's retrieval priority and decay factor.
 *   2. A `PolicyEvaluationInput` cast as a vote for the policy engine.
 *   3. An `IdentityImpactSignal` consumed by the narrative engine to
 *      drift the long-running identity vector.
 *
 * The engine is the single point at which a reward observation fans out
 * into the memory-priority, policy, and identity layers.
 */

import type { MemoryIndex, ReinforcementResult, ReinforcementSignal } from "@cognitive-substrate/core-types";
import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";

/**
 * One reinforcement observation tied to a specific memory document.
 * Only the two writable indexes can be reinforced: `experience_events`
 * (raw episodic memory) and `memory_semantic` (consolidated abstractions).
 */
export interface ReinforcementInput {
  readonly memoryId: string;
  readonly memoryIndex: Extract<MemoryIndex, "experience_events" | "memory_semantic">;
  readonly signal: ReinforcementSignal;
}

/** Aggregated update produced by one `evaluate()` call. */
export interface ReinforcementUpdate {
  readonly memoryId: string;
  readonly memoryIndex: ReinforcementInput["memoryIndex"];
  readonly result: ReinforcementResult;
  readonly policyVote: PolicyEvaluationInput;
  readonly identityImpact: IdentityImpactSignal;
}

/**
 * Side-channel signal sent to the narrative/identity engine.
 *
 *   - `curiosityDelta` : positive impact pulls identity toward exploration.
 *   - `cautionDelta`   : negative impact pulls identity toward caution.
 *   - `stabilityDelta` : large impacts in either direction reduce stability.
 */
export interface IdentityImpactSignal {
  readonly sourceMemoryId: string;
  readonly curiosityDelta: number;
  readonly cautionDelta: number;
  readonly stabilityDelta: number;
  readonly toolDependenceDelta: number;
}
