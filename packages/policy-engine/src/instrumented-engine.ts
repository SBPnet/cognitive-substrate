/**
 * InstrumentedPolicyEngine — a PolicyEngine wrapper that emits an OTel span
 * on every evaluation recording the full policy vector after the update.
 *
 * This is the T trajectory logging required by Experiment 3. Every call to
 * `applyEvaluation` produces a `policy.evaluation` span carrying:
 *
 *   cog.policy.version             — new version label
 *   cog.policy.exploration_factor  — explorationFactor after update
 *   cog.policy.retrieval_bias      — retrievalBias after update
 *   cog.reward.delta               — rewardDelta from the input
 *
 * The wrapper delegates all logic to the underlying PolicyEngine; no scoring
 * or drift computation lives here.
 */

import { getTracer, withSpan, CogAttributes } from "@cognitive-substrate/telemetry-otel";
import { PolicyEngine, type PolicyEngineConfig } from "./engine.js";
import type { PolicyEvaluationInput, PolicyUpdateResult } from "./types.js";

const tracer = getTracer("@cognitive-substrate/policy-engine");

export class InstrumentedPolicyEngine extends PolicyEngine {
  constructor(config: PolicyEngineConfig) {
    super(config);
  }

  override async applyEvaluation(
    input: PolicyEvaluationInput,
  ): Promise<PolicyUpdateResult> {
    return withSpan(
      tracer,
      "policy.evaluation",
      { [CogAttributes.REWARD_DELTA]: input.rewardDelta },
      async (span) => {
        const result = await super.applyEvaluation(input);
        span.setAttribute(CogAttributes.POLICY_VERSION, result.next.version);
        span.setAttribute(CogAttributes.POLICY_EXPLORATION_FACTOR, result.next.explorationFactor);
        span.setAttribute(CogAttributes.POLICY_RETRIEVAL_BIAS, result.next.retrievalBias);
        return result;
      },
    );
  }
}
