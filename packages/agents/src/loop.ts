/**
 * The cognitive loop: one cycle of perceive -> retrieve -> reason -> act
 * -> evaluate.
 *
 * `CognitiveLoop.process` is the canonical entry point used by the
 * orchestrator. It owns the order of operations but delegates every
 * decision to the configured ports: which session to use, which
 * memories to retrieve, how to reason, which tool to invoke, and where
 * to publish the resulting policy evaluation. The output bundles
 * everything the calling worker needs to emit downstream events
 * (interaction response, policy.evaluation, agent traces, audit).
 */

import type {
  AgentContext,
  AgentResult,
  EventResult,
  ExperienceEvent,
} from "@cognitive-substrate/core-types";
import type {
  CognitiveLoopConfig,
  CognitiveLoopResult,
  PolicyEvaluationPublisher,
} from "./types.js";

/** No-op publisher used when downstream policy evaluation is disabled. */
export class NoopPolicyEvaluationPublisher implements PolicyEvaluationPublisher {
  async publish(): Promise<void> {
    return undefined;
  }
}

export class CognitiveLoop {
  private readonly config: CognitiveLoopConfig;

  constructor(config: CognitiveLoopConfig) {
    this.config = config;
  }

  /**
   * Processes one experience event through the full loop. Steps:
   *
   *   1. Read the current policy snapshot.
   *   2. Get-or-create the cognitive session for the event.
   *   3. List active goals for the session.
   *   4. Hybrid-retrieve up to eight memories using the event text and
   *      its embedding (when present).
   *   5. Update working memory on the session.
   *   6. Build the AgentContext and call the reasoning model.
   *   7. Optionally execute the proposed action via the ToolExecutor.
   *   8. Score the loop's own decision and publish the resulting
   *      PolicyEvaluationInput.
   */
  async process(event: ExperienceEvent): Promise<CognitiveLoopResult> {
    const policy = await this.config.policyProvider.getCurrentPolicy();
    const session = await this.config.sessionManager.getOrCreate(event, policy);
    const goals = await this.config.goalProvider.listActiveGoals(session.sessionId);
    const retrieval = await this.config.memoryRetriever.retrieve({
      queryText: event.input.text,
      size: 8,
      policy,
      ...(event.input.embedding.length > 0
        ? { queryEmbedding: event.input.embedding }
        : {}),
    });

    await this.config.sessionManager.updateWorkingMemory(
      session.sessionId,
      retrieval.memories,
    );

    const context: AgentContext = {
      sessionId: session.sessionId,
      traceId: session.traceId,
      input: event,
      memories: retrieval.memories,
      goals,
      policy,
    };

    const decision = await this.config.reasoningModel.reason(context);
    const actionResult = decision.action
      ? await this.config.toolExecutor.execute(decision.action, context)
      : skippedActionResult();

    const agentResult: AgentResult = {
      agentId: "cognitive-loop",
      agentType: "executor",
      traceId: context.traceId,
      timestamp: new Date().toISOString(),
      proposal: decision.proposal,
      ...(decision.reasoning ? { reasoning: decision.reasoning } : {}),
      confidence: decision.confidence,
      riskScore: decision.riskScore,
      retrievedMemories: retrieval.memories.map((memory) => memory.memoryId),
      score: scoreDecision(decision.confidence, decision.riskScore, actionResult),
      selected: true,
    };

    const policyEvaluation = {
      sourceExperienceId: event.eventId,
      rewardDelta: actionResult.success ? decision.confidence : -decision.riskScore,
      confidence: decision.confidence,
      contradictionRisk: decision.riskScore,
      memoryUsefulness: retrieval.memories.length > 0 ? 0.75 : 0.35,
      toolUsefulness: actionResult.success ? 0.65 : 0.2,
      goalProgress: goals.some((goal) => goal.status === "active") ? 0.6 : 0.5,
    };

    await this.config.policyEvaluationPublisher.publish(policyEvaluation);

    return {
      session,
      context,
      agentResult,
      actionResult,
      policyEvaluation,
    };
  }
}

function skippedActionResult(): EventResult {
  return {
    output: "No action requested",
    success: true,
  };
}

function scoreDecision(
  confidence: number,
  riskScore: number,
  actionResult: EventResult,
): number {
  const outcome = actionResult.success ? 0.2 : -0.2;
  return Math.max(0, Math.min(1, confidence - riskScore * 0.25 + outcome));
}
