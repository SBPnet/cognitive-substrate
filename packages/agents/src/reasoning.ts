/**
 * Default fallback reasoning model and tool executor.
 *
 * `EchoReasoningModel` returns a deterministic proposal that echoes the
 * input event with a small confidence and risk derived from the policy
 * state. It exists so that the loop can run end-to-end in tests and
 * smoke checks without an external LLM. Production deployments
 * substitute an LLM-backed reasoning model.
 *
 * `LocalToolExecutor` is a no-op tool executor that always reports
 * success. It is also intended only for tests and smoke runs.
 */

import type { AgentContext, EventResult } from "@cognitive-substrate/core-types";
import type {
  ActionRequest,
  ReasoningDecision,
  ReasoningModel,
  ToolExecutor,
} from "./types.js";

export class EchoReasoningModel implements ReasoningModel {
  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const memoryCount = context.memories.length;
    const goalCount = context.goals.length;

    return {
      proposal: `Respond to ${context.input.type} with ${memoryCount} memories and ${goalCount} active goals.`,
      reasoning: "Fallback reasoning model produced a deterministic proposal.",
      confidence: memoryCount > 0 ? 0.65 : 0.45,
      riskScore: 1 - context.policy.riskTolerance,
      action: {
        tool: "respond",
        parameters: {
          text: context.input.input.text,
        },
      },
    };
  }
}

export class LocalToolExecutor implements ToolExecutor {
  async execute(action: ActionRequest): Promise<EventResult> {
    return {
      output: `Executed ${action.tool}`,
      success: true,
    };
  }
}
