/**
 * LLM-backed reasoning model using the Anthropic Claude API.
 *
 * `ClaudeReasoningModel` implements the `ReasoningModel` port and is the
 * production replacement for `EchoReasoningModel` / `MultiAgentReasoningModel`.
 * It builds a structured system prompt from the AgentContext (retrieved
 * memories, active goals, policy vector, available tools), calls Claude
 * with tool_use enabled, and maps the response back to a `ReasoningDecision`.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY  — Claude API key
 *   ANTHROPIC_MODEL    — optional model override (default: claude-sonnet-4-6)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AgentContext, MemoryReference, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest, ReasoningDecision, ReasoningModel } from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

export interface ClaudeReasoningModelConfig {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  readonly apiKey?: string;
  /** Model identifier. Defaults to ANTHROPIC_MODEL env var or claude-sonnet-4-6. */
  readonly model?: string;
}

export class ClaudeReasoningModel implements ReasoningModel {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ClaudeReasoningModelConfig = {}) {
    this.client = new Anthropic({
      apiKey: config.apiKey ?? process.env["ANTHROPIC_API_KEY"],
    });
    this.model = config.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
  }

  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const systemPrompt = buildSystemPrompt(context);
    const tools = buildAnthropicTools(context.capabilities);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages: [
        {
          role: "user",
          content: context.input.input.text,
        },
      ],
    });

    return parseResponse(message);
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: AgentContext): string {
  const parts: string[] = [
    "You are a cognitive agent with access to persistent long-term memory. Your task is to reason about the user's input using retrieved memories and active goals, then either respond or invoke a tool.",
    "",
    `Session: ${ctx.sessionId}`,
    `Policy — retrievalBias: ${ctx.policy.retrievalBias.toFixed(2)}, riskTolerance: ${ctx.policy.riskTolerance.toFixed(2)}, explorationFactor: ${ctx.policy.explorationFactor.toFixed(2)}`,
  ];

  if (ctx.memories.length > 0) {
    parts.push("", "## Retrieved memories (highest relevance first)");
    for (const mem of ctx.memories) {
      parts.push(formatMemory(mem));
    }
  } else {
    parts.push("", "No relevant memories retrieved for this input.");
  }

  if (ctx.goals.length > 0) {
    parts.push("", "## Active goals");
    for (const goal of ctx.goals) {
      parts.push(`- [${goal.horizon}] ${goal.description} (priority ${goal.priority.toFixed(2)}, progress ${(goal.progress * 100).toFixed(0)}%)`);
    }
  }

  parts.push(
    "",
    "Respond concisely and factually. Ground your answer in the retrieved memories when relevant. If you invoke a tool, use the result to inform your final response.",
  );

  return parts.join("\n");
}

function formatMemory(mem: MemoryReference): string {
  return `- [score ${mem.score.toFixed(3)}, importance ${mem.importanceScore.toFixed(2)}] ${mem.summary}`;
}

// ---------------------------------------------------------------------------
// Tool conversion: ToolCapability → Anthropic tool schema
// ---------------------------------------------------------------------------

function buildAnthropicTools(capabilities: ReadonlyArray<ToolCapability>): Anthropic.Tool[] {
  return capabilities.map((cap) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    for (const param of cap.parameters ?? []) {
      properties[param.name] = { type: param.type };
      if (param.required) required.push(param.name);
    }

    return {
      name: cap.tool,
      description: cap.description,
      input_schema: {
        type: "object" as const,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponse(message: Anthropic.Message): ReasoningDecision {
  let proposal = "";
  let action: ActionRequest | undefined;

  for (const block of message.content) {
    if (block.type === "text") {
      proposal = block.text;
    } else if (block.type === "tool_use") {
      action = {
        tool: block.name,
        parameters: block.input as Record<string, unknown>,
      };
    }
  }

  // If Claude only called a tool (no text block), use the tool name as the proposal summary.
  if (!proposal && action) {
    proposal = `Invoking tool: ${action.tool}`;
  }

  const stopReason = message.stop_reason;

  // Derive confidence and riskScore from stop reason and token usage.
  // end_turn = normal completion → higher confidence; tool_use = acting → moderate.
  const confidence = stopReason === "end_turn" ? 0.82 : 0.70;
  const riskScore = stopReason === "max_tokens" ? 0.55 : 0.18;

  return { proposal, confidence, riskScore, ...(action ? { action } : {}) };
}

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

// Exported so callers can check availability before wiring.
export function claudeAvailable(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]);
}

