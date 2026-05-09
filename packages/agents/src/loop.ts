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
