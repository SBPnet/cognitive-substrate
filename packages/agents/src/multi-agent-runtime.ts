/**
 * Multi-agent runtime.
 *
 * `MultiAgentRuntime.run` invokes every configured agent in parallel,
 * arbitrates the results, copies the critic agent's annotation onto
 * the winning result, and records each trace to the configured
 * activity store.
 *
 * `MultiAgentReasoningModel` adapts the runtime to the
 * `ReasoningModel` interface so that the cognitive loop can use a
 * multi-agent debate as its reasoning model without any special
 * casing.
 */

import type { AgentContext, AgentResult } from "@cognitive-substrate/core-types";
import { arbitrate, scoreAgentResult } from "./arbitration.js";
import { NoopAgentActivityStore } from "./activity-store.js";
import { createDefaultAgents } from "./specialized-agents.js";
import type {
  AgentActivityStore,
  CognitiveAgent,
  MultiAgentRuntimeResult,
  ReasoningDecision,
  ReasoningModel,
} from "./types.js";

export interface MultiAgentRuntimeConfig {
  readonly agents?: ReadonlyArray<CognitiveAgent>;
  readonly activityStore?: AgentActivityStore;
}

export class MultiAgentRuntime {
  private readonly agents: ReadonlyArray<CognitiveAgent>;
  private readonly activityStore: AgentActivityStore;

  constructor(config: MultiAgentRuntimeConfig = {}) {
    this.agents = config.agents ?? createDefaultAgents();
    this.activityStore = config.activityStore ?? new NoopAgentActivityStore();
  }

  async run(context: AgentContext): Promise<MultiAgentRuntimeResult> {
    const rawResults = await Promise.all(
      this.agents.map((agent) => agent.run(context)),
    );
    const decision = arbitrate(rawResults);
    const criticAnnotation = rawResults.find(
      (result) => result.agentType === "critic" && result.critique,
    )?.critique;
    const results = rawResults.map((result) =>
      markSelection(result, decision.winnerId, criticAnnotation),
    );

    await Promise.all(
      results.map((result) =>
        this.activityStore.record({
          traceId: `${context.traceId}:${result.agentId}`,
          timestamp: result.timestamp,
          agentType: result.agentType,
          inputSummary: context.input.input.text.slice(0, 500),
          proposedAction: result.proposal,
          confidence: result.confidence,
          score: result.score ?? 0,
          selected: result.selected ?? false,
          ...(result.critique ? { critique: result.critique } : {}),
          ...(result.embedding ? { embedding: result.embedding } : {}),
        }),
      ),
    );

    return { results, decision };
  }
}

export class MultiAgentReasoningModel implements ReasoningModel {
  private readonly runtime: MultiAgentRuntime;

  constructor(runtime: MultiAgentRuntime = new MultiAgentRuntime()) {
    this.runtime = runtime;
  }

  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const result = await this.runtime.run(context);
    const winner = result.results.find(
      (agentResult) => agentResult.agentId === result.decision.winnerId,
    );
    if (!winner) {
      throw new Error("multi-agent reasoning produced no winning proposal");
    }

    return {
      proposal: result.decision.winnerProposal,
      ...(winner.reasoning ? { reasoning: winner.reasoning } : {}),
      confidence: result.decision.confidence,
      riskScore: winner.riskScore,
      action: {
        tool: "respond",
        parameters: {
          proposal: result.decision.winnerProposal,
        },
      },
    };
  }
}

function markSelection(
  result: AgentResult,
  winnerId: string,
  criticAnnotation: string | undefined,
): AgentResult {
  const selected = result.agentId === winnerId;
  return {
    ...result,
    score: result.score ?? scoreAgentResult(result),
    selected,
    ...(selected && criticAnnotation ? { critique: criticAnnotation } : {}),
  };
}
