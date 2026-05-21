/**
 * OpenAI-compatible reasoning model for self-hosted inference servers.
 *
 * Works with any server that exposes the `/v1/chat/completions` endpoint
 * with tool calling support — xAI Grok, vLLM, llama.cpp server, Ollama, etc.
 *
 * Default target: xAI Grok API
 *   OPENAI_BASE_URL=https://api.x.ai/v1
 *   OPENAI_MODEL=grok-4.3   (or grok-4.20-0309-reasoning, grok-3-mini, etc.)
 *
 * Required env vars:
 *   OPENAI_BASE_URL  — base URL of the inference server
 *   OPENAI_API_KEY   — API key (xAI key starts with "xai-")
 *   OPENAI_MODEL     — model identifier (default: grok-4.3)
 */

import OpenAI from "openai";
import type { AgentContext, MemoryReference, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest, ReasoningDecision, ReasoningModel } from "./types.js";

const DEFAULT_MODEL = "grok-4.3";
const MAX_TOKENS = 1024;

export interface OpenAICompatReasoningModelConfig {
  /** Base URL of the inference server. Defaults to OPENAI_BASE_URL env var. */
  readonly baseURL?: string;
  /** API key (any non-empty string works for local vLLM). Defaults to OPENAI_API_KEY env var or "local". */
  readonly apiKey?: string;
  /** Model identifier as served. Defaults to OPENAI_MODEL env var or "command-a-plus". */
  readonly model?: string;
  /** Max tokens for completion. Defaults to 1024. */
  readonly maxTokens?: number;
}

export class OpenAICompatReasoningModel implements ReasoningModel {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: OpenAICompatReasoningModelConfig = {}) {
    const baseURL = config.baseURL ?? process.env["OPENAI_BASE_URL"];
    if (!baseURL) {
      throw new Error("OpenAICompatReasoningModel: baseURL is required (set OPENAI_BASE_URL)");
    }
    this.client = new OpenAI({
      baseURL,
      apiKey: config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "local",
    });
    this.model = config.model ?? process.env["OPENAI_MODEL"] ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? MAX_TOKENS;
  }

  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const tools = buildOpenAITools(context.capabilities);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        { role: "user", content: context.input.input.text },
      ],
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    });

    return parseResponse(response);
  }
}

// ---------------------------------------------------------------------------
// Prompt construction (mirrors llm-reasoning.ts buildSystemPrompt)
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
      parts.push(
        `- [${goal.horizon}] ${goal.description} (priority ${goal.priority.toFixed(2)}, progress ${(goal.progress * 100).toFixed(0)}%)`,
      );
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
// Tool conversion: ToolCapability → OpenAI function schema
// ---------------------------------------------------------------------------

function buildOpenAITools(capabilities: ReadonlyArray<ToolCapability>): OpenAI.Chat.ChatCompletionTool[] {
  if (capabilities.length === 0) return [];

  return capabilities.map((cap) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    for (const param of cap.parameters ?? []) {
      properties[param.name] = { type: param.type };
      if (param.required) required.push(param.name);
    }

    return {
      type: "function" as const,
      function: {
        name: cap.tool,
        description: cap.description,
        parameters: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseResponse(response: OpenAI.Chat.ChatCompletion): ReasoningDecision {
  const choice = response.choices[0];
  if (!choice) {
    return { proposal: "", confidence: 0.1, riskScore: 0.9 };
  }

  const message = choice.message;
  let proposal = message.content ?? "";
  let action: ActionRequest | undefined;

  const toolCall = message.tool_calls?.[0];
  if (toolCall?.type === "function") {
    const fn = toolCall.function;
    let parameters: Record<string, unknown> | undefined;
    try {
      parameters = JSON.parse(fn.arguments) as Record<string, unknown>;
    } catch {
      parameters = undefined;
    }
    action = {
      tool: fn.name,
      ...(parameters ? { parameters } : {}),
    };
    if (!proposal) {
      proposal = `Invoking tool: ${fn.name}`;
    }
  }

  const finishReason = choice.finish_reason;
  const confidence = finishReason === "stop" ? 0.82 : finishReason === "tool_calls" ? 0.70 : 0.55;
  const riskScore = finishReason === "length" ? 0.55 : 0.18;

  return { proposal, confidence, riskScore, ...(action ? { action } : {}) };
}

// ---------------------------------------------------------------------------
// Availability helper (mirrors claudeAvailable in llm-reasoning.ts)
// ---------------------------------------------------------------------------

export function openAICompatAvailable(): boolean {
  return Boolean(process.env["OPENAI_BASE_URL"]);
}
