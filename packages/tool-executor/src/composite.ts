/**
 * CompositeToolExecutor — production ToolExecutor implementation.
 *
 * Combines built-in tools (WebFetch, MemorySearch, WriteExperience) with
 * zero or more MCP server connections. The MCP bridge is optional; if no
 * servers are configured, only the built-in tools are exposed.
 */

import type { AgentContext, EventResult, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest, ToolExecutor } from "@cognitive-substrate/agents";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { MemoryRetrieverPort } from "@cognitive-substrate/agents";
import { WEB_FETCH_CAPABILITY, webFetch } from "./web-fetch.js";
import { MEMORY_SEARCH_CAPABILITY, MemorySearchTool } from "./memory-search.js";
import { WRITE_EXPERIENCE_CAPABILITY, WriteExperienceTool } from "./write-experience.js";
import { McpToolBridge, type McpServerConfig } from "./mcp-bridge.js";

export interface CompositeToolExecutorConfig {
  readonly producer: CognitiveProducer;
  readonly memoryRetriever: MemoryRetrieverPort;
  /** MCP server configs to connect at startup. Empty means no MCP. */
  readonly mcpServers?: ReadonlyArray<McpServerConfig>;
}

export class CompositeToolExecutor implements ToolExecutor {
  private readonly memorySearchTool: MemorySearchTool;
  private readonly writeExperienceTool: WriteExperienceTool;
  private readonly mcpBridge: McpToolBridge;

  constructor(config: CompositeToolExecutorConfig) {
    this.memorySearchTool = new MemorySearchTool(config.memoryRetriever);
    this.writeExperienceTool = new WriteExperienceTool(config.producer);
    this.mcpBridge = new McpToolBridge(config.producer);
  }

  /** Connect to MCP servers. Must be called before the loop starts. */
  async connect(mcpServers: ReadonlyArray<McpServerConfig> = []): Promise<void> {
    if (mcpServers.length > 0) {
      await this.mcpBridge.connect(mcpServers);
    }
  }

  async disconnect(): Promise<void> {
    await this.mcpBridge.disconnect();
  }

  listTools(): ReadonlyArray<ToolCapability> {
    return [
      WEB_FETCH_CAPABILITY,
      MEMORY_SEARCH_CAPABILITY,
      WRITE_EXPERIENCE_CAPABILITY,
      ...this.mcpBridge.listTools(),
    ];
  }

  async execute(action: ActionRequest, context: AgentContext): Promise<EventResult> {
    if (this.mcpBridge.handles(action)) {
      return this.mcpBridge.execute(action, context);
    }

    switch (action.tool) {
      case "web_fetch":
        return webFetch(action, context);
      case "memory_search":
        return this.memorySearchTool.execute(action, context);
      case "write_experience":
        return this.writeExperienceTool.execute(action, context);
      default:
        return { output: `Unknown tool: ${action.tool}`, success: false };
    }
  }
}
