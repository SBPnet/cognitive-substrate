/**
 * Bounded drift arithmetic for the policy vector.
 *
 * The reinforcement loop must change the policy vector only by small,
 * bounded amounts per evaluation. Otherwise a single high-magnitude reward
 * could collapse retrieval, tool use, or risk tolerance to extreme values
 * and destabilise downstream subsystems.
 *
 * Two safety constraints are enforced here:
 *   1. Each per-dimension delta is clamped to `[-MAX_ABSOLUTE_DRIFT, +MAX_ABSOLUTE_DRIFT]`.
 *   2. Each post-application value is clamped to `[0, 1]`.
 *
 * The numeric weights inside `computePolicyDelta` are tuning constants
 * chosen so that retrievalBias and toolBias respond fastest to clear
 * positive evidence, while explorationFactor and risk-related dimensions
 * move more slowly.
 */

import type { PolicyState } from "@cognitive-substrate/core-types";
import type {
  PolicyDelta,
  PolicyEvaluationInput,
  PolicyVectorKey,
} from "./types.js";

/** Maximum absolute change that any single evaluation may apply to a dimension. */
const MAX_ABSOLUTE_DRIFT = 0.08;

/**
 * Translates a single PolicyEvaluationInput into a sparse, bounded
 * PolicyDelta. The transform is:
 *
 *   - retrievalBias and memoryTrust grow when memory was useful and reward
 *     was positive; they shrink when reward was negative or memory
 *     contradicted prior beliefs.
 *   - toolBias tracks the marginal usefulness of tool invocation.
 *   - riskTolerance grows with confidence and shrinks with contradiction risk.
 *   - explorationFactor grows when confidence is low or contradictions
 *     appear, encouraging the system to look elsewhere for evidence.
 *   - goalPersistence tracks observed goal progress.
 *   - workingMemoryDecayRate moves opposite memoryUsefulness so that
 *     productive memory is retained longer in the working set.
 *
 * All deltas pass through `clampDelta` to keep them inside the per-step
 * drift bound.
 */
export function computePolicyDelta(input: PolicyEvaluationInput): PolicyDelta {
  const reward = clampSigned(input.rewardDelta);
  const confidence = input.confidence ?? 0.5;
  const contradictionRisk = input.contradictionRisk ?? 0;
  const memoryUsefulness = input.memoryUsefulness ?? 0.5;
  const toolUsefulness = input.toolUsefulness ?? 0.5;
  const goalProgress = input.goalProgress ?? 0.5;

  return clampDelta({
    retrievalBias: reward * (memoryUsefulness - 0.5) * 0.18,
    memoryTrust: reward * (memoryUsefulness - contradictionRisk) * 0.12,
    toolBias: reward * (toolUsefulness - 0.5) * 0.16,
    riskTolerance: reward * (confidence - contradictionRisk - 0.25) * 0.1,
    explorationFactor: reward * (0.5 - confidence + contradictionRisk) * 0.08,
    goalPersistence: reward * (goalProgress - 0.5) * 0.12,
    workingMemoryDecayRate: -reward * (memoryUsefulness - 0.5) * 0.08,
  });
}

/**
 * Applies a PolicyDelta to a current PolicyState, producing the next
 * snapshot. Every output dimension is clamped to `[0, 1]`. Missing entries
 * in the delta are treated as zero (no change).
 */
export function applyPolicyDelta(
  current: PolicyState,
  delta: PolicyDelta,
  nextVersion: string,
  timestamp: string = new Date().toISOString(),
): PolicyState {
  return {
    version: nextVersion,
    timestamp,
    retrievalBias: applyDelta(current.retrievalBias, delta.retrievalBias),
    toolBias: applyDelta(current.toolBias, delta.toolBias),
    riskTolerance: applyDelta(current.riskTolerance, delta.riskTolerance),
    memoryTrust: applyDelta(current.memoryTrust, delta.memoryTrust),
    explorationFactor: applyDelta(current.explorationFactor, delta.explorationFactor),
    goalPersistence: applyDelta(current.goalPersistence, delta.goalPersistence),
    workingMemoryDecayRate: applyDelta(
      current.workingMemoryDecayRate,
      delta.workingMemoryDecayRate,
    ),
  };
}

/** Clamps a value to the unit interval `[0, 1]`. */
export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function applyDelta(current: number, delta: number | undefined): number {
  return clampUnit(current + (delta ?? 0));
}

function clampDelta(delta: Required<PolicyDelta>): PolicyDelta {
  return Object.fromEntries(
    Object.entries(delta).map(([key, value]) => [
      key,
      Math.max(-MAX_ABSOLUTE_DRIFT, Math.min(MAX_ABSOLUTE_DRIFT, value)),
    ]),
  ) as Record<PolicyVectorKey, number>;
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
