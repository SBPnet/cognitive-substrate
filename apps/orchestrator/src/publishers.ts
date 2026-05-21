import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import { Topics } from "@cognitive-substrate/kafka-bus";
import type { CognitiveLoopResult, PolicyEvaluationPublisher } from "@cognitive-substrate/agents";

export class KafkaPolicyEvaluationPublisher implements PolicyEvaluationPublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(input: PolicyEvaluationInput): Promise<void> {
    await this.producer.publish(Topics.POLICY_EVALUATION, input, {
      key: input.sourceExperienceId,
    });
  }
}

/**
 * Publishes an `agent_action` ExperienceEvent for each completed cognitive
 * loop turn so the reinforcement engine can score and compound the agent's
 * own decisions — closing the contribution loop described in the blog's
 * memory-in-conversation architecture.
 */
export class AgentActionPublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(sourceEvent: ExperienceEvent, result: CognitiveLoopResult): Promise<void> {
    const { agentResult, actionResult, policyEvaluation, context } = result;

    const event: ExperienceEvent = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "agent_action",
      context: {
        sessionId: context.sessionId,
        agentId: agentResult.agentId,
        traceId: agentResult.traceId,
        policyVersion: context.policy.version,
        ...(context.goals[0]?.goalId ? { goalId: context.goals[0].goalId } : {}),
      },
      input: {
        // Mirror the original user input text so retrieval finds this event
        // when the same topic recurs in a future session.
        text: sourceEvent.input.text,
        embedding: [],
      },
      action: {
        tool: result.actionResult.output.startsWith("Executed ")
          ? result.actionResult.output.replace("Executed ", "")
          : "respond",
        ...(agentResult.reasoning ? { reasoning: agentResult.reasoning } : {}),
      },
      result: {
        output: agentResult.proposal,
        success: actionResult.success,
        ...(actionResult.latencyMs !== undefined ? { latencyMs: actionResult.latencyMs } : {}),
      },
      internalState: {
        confidence: agentResult.confidence,
        workingMemorySnapshot: `${context.memories.length} memories`,
        activePlan: agentResult.proposal.slice(0, 120),
      },
      evaluation: {
        rewardScore: policyEvaluation.rewardDelta,
        selfAssessedQuality: agentResult.confidence,
      },
      importanceScore: Math.min(
        1,
        agentResult.confidence * 0.6 + (actionResult.success ? 0.2 : 0) + (policyEvaluation.memoryUsefulness ?? 0.5) * 0.2,
      ),
      tags: [
        "source:agent",
        `session:${context.sessionId}`,
        `agent:${agentResult.agentId}`,
        ...(actionResult.success ? ["outcome:success"] : ["outcome:failure"]),
      ],
    };

    await this.producer.publish(Topics.EXPERIENCE_RAW, event, {
      key: context.sessionId,
    });
  }
}
