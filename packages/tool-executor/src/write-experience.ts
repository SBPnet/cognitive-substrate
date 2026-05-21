import { randomUUID } from "node:crypto";
import type { AgentContext, EventResult, ExperienceEvent, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest } from "@cognitive-substrate/agents";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import { Topics } from "@cognitive-substrate/kafka-bus";

export const WRITE_EXPERIENCE_CAPABILITY: ToolCapability = {
  tool: "write_experience",
  description: "Explicitly record a high-importance observation or insight into long-term memory. Use when you discover something worth remembering that would not otherwise be captured.",
  parameters: [
    { name: "text", type: "string", required: true },
    { name: "importance", type: "number", required: false },
    { name: "tags", type: "string", required: false },
  ],
};

export class WriteExperienceTool {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async execute(action: ActionRequest, context: AgentContext): Promise<EventResult> {
    const text = action.parameters?.["text"];
    if (typeof text !== "string" || !text) {
      return { output: "write_experience requires a text parameter", success: false };
    }

    const importance = typeof action.parameters?.["importance"] === "number"
      ? Math.min(1, Math.max(0, action.parameters["importance"]))
      : 0.75;

    const extraTags = typeof action.parameters?.["tags"] === "string"
      ? (action.parameters["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const event: ExperienceEvent = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "agent_action",
      context: {
        sessionId: context.sessionId,
        agentId: "write-experience-tool",
        traceId: context.traceId,
      },
      input: { text, embedding: [] },
      importanceScore: importance,
      tags: ["source:agent", "tool:write_experience", ...extraTags],
    };

    try {
      await this.producer.publish(Topics.EXPERIENCE_RAW, event, { key: context.sessionId });
      return { output: `Recorded experience (importance=${importance.toFixed(2)})`, success: true };
    } catch (err) {
      return {
        output: err instanceof Error ? err.message : String(err),
        success: false,
        errorCode: "PUBLISH_ERROR",
      };
    }
  }
}
