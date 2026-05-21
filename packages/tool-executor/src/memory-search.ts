import type { AgentContext, EventResult, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest } from "@cognitive-substrate/agents";
import type { MemoryRetrieverPort } from "@cognitive-substrate/agents";

export const MEMORY_SEARCH_CAPABILITY: ToolCapability = {
  tool: "memory_search",
  description: "Search long-term memory for experiences and semantic memories related to a query. Returns up to 5 relevant memories.",
  parameters: [
    { name: "query", type: "string", required: true },
    { name: "min_importance", type: "number", required: false },
  ],
};

export class MemorySearchTool {
  private readonly retriever: MemoryRetrieverPort;

  constructor(retriever: MemoryRetrieverPort) {
    this.retriever = retriever;
  }

  async execute(action: ActionRequest, context: AgentContext): Promise<EventResult> {
    const query = action.parameters?.["query"];
    if (typeof query !== "string" || !query) {
      return { output: "memory_search requires a query parameter", success: false };
    }

    const minImportance = typeof action.parameters?.["min_importance"] === "number"
      ? action.parameters["min_importance"]
      : 0;

    const start = Date.now();
    try {
      const result = await this.retriever.retrieve({
        queryText: query,
        size: 5,
        policy: context.policy,
        ...(minImportance > 0 ? { minImportance } : {}),
      });

      if (result.memories.length === 0) {
        return { output: "No memories found for this query.", success: true, latencyMs: Date.now() - start };
      }

      const lines = result.memories.map(
        (m, i) => `${i + 1}. [score ${m.score.toFixed(3)}] ${m.summary}`,
      );
      return {
        output: lines.join("\n"),
        success: true,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        output: err instanceof Error ? err.message : String(err),
        success: false,
        latencyMs: Date.now() - start,
        errorCode: "RETRIEVAL_ERROR",
      };
    }
  }
}
