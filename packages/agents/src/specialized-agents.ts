/**
 * Deterministic specialised agents.
 *
 * Each agent in this file produces an `AgentResult` from an
 * `AgentContext` using fixed heuristics over the policy vector and
 * available memory. They are intentionally cheap and predictable so
 * that the multi-agent runtime can run them all on every cycle without
 * blowing the compute budget. Production deployments often add or
 * replace agents with LLM-backed variants; the contract is stable so
 * that the arbitration layer does not need to change.
 *
 * The six default agents map onto the multi-agent debate roles
 * described in the architecture: planner, executor, critic, memory,
 * world-model, and meta-cognition.
 */

import type { AgentContext, AgentResult, AgentType } from "@cognitive-substrate/core-types";
import type { CognitiveAgent } from "./types.js";

/**
 * Shared base class. Subclasses override `propose`; everything else has
 * a sensible default keyed off the AgentContext.
 */
abstract class DeterministicAgent implements CognitiveAgent {
  protected abstract readonly agentId: string;
  protected abstract readonly agentType: AgentType;

  async run(context: AgentContext): Promise<AgentResult> {
    const critique = this.critique(context);
    return {
      agentId: this.agentId,
      agentType: this.agentType,
      traceId: context.traceId,
      timestamp: new Date().toISOString(),
      proposal: this.propose(context),
      reasoning: this.reason(context),
      confidence: this.confidence(context),
      riskScore: this.risk(context),
      retrievedMemories: context.memories.map((memory) => memory.memoryId),
      ...(critique ? { critique } : {}),
    };
  }

  protected abstract propose(context: AgentContext): string;

  protected reason(context: AgentContext): string {
    return `Agent ${this.agentId} evaluated ${context.memories.length} memories and ${context.goals.length} goals.`;
  }

  protected confidence(context: AgentContext): number {
    return context.memories.length > 0 ? 0.65 : 0.45;
  }

  protected risk(context: AgentContext): number {
    return 1 - context.policy.riskTolerance;
  }

  protected critique(_context: AgentContext): string | undefined {
    return undefined;
  }
}

export class PlannerAgent extends DeterministicAgent {
  protected readonly agentId = "planner-agent";
  protected readonly agentType = "planner";

  protected propose(context: AgentContext): string {
    return `Plan next step for: ${context.input.input.text}`;
  }
}

export class ExecutorAgent extends DeterministicAgent {
  protected readonly agentId = "executor-agent";
  protected readonly agentType = "executor";

  protected propose(context: AgentContext): string {
    return `Execute response action for event ${context.input.eventId}`;
  }

  protected override confidence(context: AgentContext): number {
    return context.policy.toolBias * 0.4 + 0.45;
  }
}

export class CriticAgent extends DeterministicAgent {
  protected readonly agentId = "critic-agent";
  protected readonly agentType = "critic";

  protected propose(context: AgentContext): string {
    return `Critique risk before acting on ${context.input.type}`;
  }

  protected override risk(context: AgentContext): number {
    return Math.min(1, 0.35 + context.memories.length * 0.02);
  }

  protected override critique(context: AgentContext): string {
    return `Risk review: policy risk tolerance is ${context.policy.riskTolerance.toFixed(2)} with ${context.memories.length} memory references.`;
  }
}

export class MemoryAgent extends DeterministicAgent {
  protected readonly agentId = "memory-agent";
  protected readonly agentType = "memory";

  protected propose(context: AgentContext): string {
    return `Use ${context.memories.length} retrieved memories to ground the response.`;
  }

  protected override confidence(context: AgentContext): number {
    return context.policy.memoryTrust * 0.5 + (context.memories.length > 0 ? 0.35 : 0.15);
  }
}

export class WorldModelAgent extends DeterministicAgent {
  protected readonly agentId = "world-model-agent";
  protected readonly agentType = "world_model";

  protected propose(context: AgentContext): string {
    return `Predict outcome before responding to ${context.input.eventId}`;
  }

  protected override risk(context: AgentContext): number {
    return Math.max(0, 0.65 - context.policy.riskTolerance * 0.4);
  }
}

export class MetaCognitionAgent extends DeterministicAgent {
  protected readonly agentId = "meta-cognition-agent";
  protected readonly agentType = "meta_cognition";

  protected propose(context: AgentContext): string {
    return `Reflect on confidence and failure modes for trace ${context.traceId}`;
  }

  protected override confidence(context: AgentContext): number {
    return Math.min(1, 0.5 + context.policy.memoryTrust * 0.25 + context.policy.goalPersistence * 0.15);
  }

  protected override critique(context: AgentContext): string {
    return `Meta-cognitive review covers ${context.goals.length} active goals and ${context.memories.length} memory references.`;
  }
}

/**
 * Returns the canonical six-agent default lineup used by
 * `MultiAgentRuntime` when no explicit `agents` array is configured.
 */
export function createDefaultAgents(): ReadonlyArray<CognitiveAgent> {
  return [
    new PlannerAgent(),
    new ExecutorAgent(),
    new CriticAgent(),
    new MemoryAgent(),
    new WorldModelAgent(),
    new MetaCognitionAgent(),
  ];
}
