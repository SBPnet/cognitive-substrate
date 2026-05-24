/**
 * Google Gemini reasoning model.
 *
 * Required env vars:
 *   GEMINI_API_KEY   — Google AI Studio API key
 *   GEMINI_MODEL     — optional model override (default: gemini-2.0-flash)
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclaration, Schema } from "@google/generative-ai";
import type { AgentContext, MemoryReference, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest, ReasoningDecision, ReasoningModel } from "./types.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

export interface GeminiReasoningModelConfig {
  readonly apiKey?: string;
  readonly model?: string;
}

export class GeminiReasoningModel implements ReasoningModel {
  private readonly genai: GoogleGenerativeAI;
  private readonly model: string;

  constructor(config: GeminiReasoningModelConfig = {}) {
    const apiKey = config.apiKey ?? process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("GeminiReasoningModel: GEMINI_API_KEY is required");
    this.genai = new GoogleGenerativeAI(apiKey);
    this.model = config.model ?? process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL;
  }

  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const model = this.genai.getGenerativeModel({
      model: this.model,
      tools: [{ functionDeclarations: buildGeminiTools(context.capabilities) }],
      systemInstruction: buildSystemPrompt(context),
    });

    const result = await model.generateContent(context.input.input.text);
    const candidate = result.response.candidates?.[0];
    if (!candidate) return { proposal: "", confidence: 0.5, riskScore: 0.3 };

    let proposal = "";
    let action: ActionRequest | undefined;

    for (const part of candidate.content.parts) {
      if (part.text) {
        proposal = part.text;
      } else if (part.functionCall) {
        action = {
          tool: part.functionCall.name,
          parameters: part.functionCall.args as Record<string, unknown>,
        };
      }
    }

    if (!proposal && action) proposal = `Invoking tool: ${action.tool}`;

    const finishReason = candidate.finishReason;
    const confidence = finishReason === "STOP" ? 0.82 : 0.70;
    const riskScore = finishReason === "MAX_TOKENS" ? 0.55 : 0.18;

    return { proposal, confidence, riskScore, ...(action ? { action } : {}) };
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
      parts.push(
        `- [${goal.horizon}] ${goal.description} (priority ${goal.priority.toFixed(2)}, progress ${(goal.progress * 100).toFixed(0)}%)`,
      );
    }
  }

  parts.push(
    "",
    "Respond concisely and factually. Ground your answer in retrieved memories when relevant. If you invoke a tool, use the result to inform your final response.",
  );
  return parts.join("\n");
}

function formatMemory(mem: MemoryReference): string {
  return `- [score ${mem.score.toFixed(3)}, importance ${mem.importanceScore.toFixed(2)}] ${mem.summary}`;
}

// ---------------------------------------------------------------------------
// Tool conversion: ToolCapability -> Gemini FunctionDeclaration
// ---------------------------------------------------------------------------

function buildGeminiTools(capabilities: ReadonlyArray<ToolCapability>): FunctionDeclaration[] {
  return capabilities.map((cap) => {
    const properties: Record<string, Schema> = {};
    for (const param of cap.parameters ?? []) {
      const desc = param.description;
      if (param.type === "number") {
        const schema: Schema = desc !== undefined
          ? { type: SchemaType.NUMBER, description: desc }
          : { type: SchemaType.NUMBER };
        properties[param.name] = schema;
      } else {
        const schema: Schema = desc !== undefined
          ? { type: SchemaType.STRING, description: desc }
          : { type: SchemaType.STRING };
        properties[param.name] = schema;
      }
    }
    const required = (cap.parameters ?? []).filter((p) => p.required).map((p) => p.name);
    const decl: FunctionDeclaration = {
      name: cap.tool,
      description: cap.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
    return decl;
  });
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

export function geminiAvailable(): boolean {
  return Boolean(process.env["GEMINI_API_KEY"]);
}
