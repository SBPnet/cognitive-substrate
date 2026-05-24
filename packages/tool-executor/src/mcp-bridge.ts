/**
 * MCP tool bridge — connects to one or more MCP servers at startup,
 * discovers their tool surfaces, and routes tool calls to the appropriate
 * server. Every result (success or error) is published as a `tool_result`
 * ExperienceEvent so MCP responses become first-class memory substrate
 * events subject to reinforcement and consolidation.
 *
 * Server configuration is read from MCP_SERVERS env var:
 *   JSON array of McpServerConfig objects, e.g.:
 *   [{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]
 *   or HTTP: [{"name":"remote","url":"http://localhost:3001/mcp"}]
 */

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentContext, ContentBlock, EventResult, ExperienceEvent, ToolCapability } from "@cognitive-substrate/core-types";
import type { ActionRequest } from "@cognitive-substrate/agents";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import { Topics } from "@cognitive-substrate/kafka-bus";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface McpStdioServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  readonly name: string;
  readonly url: string;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

function isHttpConfig(c: McpServerConfig): c is McpHttpServerConfig {
  return "url" in c;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

interface ConnectedServer {
  readonly name: string;
  client: Client;
  tools: ReadonlyArray<ToolCapability>;
  readonly config: McpServerConfig;
  healthy: boolean;
}

/** MCP tool name prefix used in ToolCapability.tool to namespace by server. */
const MCP_PREFIX = "mcp";

function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}:${serverName}:${toolName}`;
}

export class McpToolBridge {
  private readonly producer: CognitiveProducer;
  private servers: ConnectedServer[] = [];

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  /**
   * Connect to all configured MCP servers and discover their tools.
   * Call once at startup before the cognitive loop begins processing.
   */
  async connect(configs: ReadonlyArray<McpServerConfig>): Promise<void> {
    await Promise.all(configs.map((cfg) => this.connectOne(cfg)));
  }

  private async connectOne(cfg: McpServerConfig, retryDelayMs = 500, maxRetries = 5): Promise<void> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const client = new Client({ name: "cognitive-substrate", version: "1.0.0" });
        let transport;
        if (isHttpConfig(cfg)) {
          transport = new StreamableHTTPClientTransport(new URL(cfg.url));
        } else {
          transport = new StdioClientTransport({
            command: cfg.command,
            args: cfg.args ?? [],
            ...(cfg.env ? { env: cfg.env } : {}),
          });
        }

        // The MCP SDK Transport type uses exactOptionalPropertyTypes internally;
        // cast through unknown to satisfy the strict assignment check.
        await client.connect(transport as Parameters<typeof client.connect>[0]);

        const { tools: rawTools } = await client.listTools();
        const tools = this.mapTools(cfg.name, rawTools);

        const existing = this.servers.findIndex((s) => s.name === cfg.name);
        if (existing >= 0) {
          const entry = this.servers[existing];
          if (entry !== undefined) {
            entry.client = client;
            entry.tools = tools;
            entry.healthy = true;
          }
        } else {
          this.servers.push({ name: cfg.name, client, tools, config: cfg, healthy: true });
        }
        return;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) {
          process.stderr.write(
            `[mcp-bridge] Failed to connect to "${cfg.name}" after ${maxRetries} retries: ${(err as Error).message}\n`,
          );
          // Mark as unhealthy if a prior entry exists; otherwise push a stub.
          const existing = this.servers.findIndex((s) => s.name === cfg.name);
          if (existing < 0) {
            // No entry yet — push a zero-tool placeholder so healthStatus() shows the failure.
            this.servers.push({
              name: cfg.name,
              client: new Client({ name: "cognitive-substrate", version: "1.0.0" }),
              tools: [],
              config: cfg,
              healthy: false,
            });
          } else {
            const entry = this.servers[existing];
            if (entry !== undefined) entry.healthy = false;
          }
          return;
        }
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        process.stderr.write(
          `[mcp-bridge] Retrying "${cfg.name}" in ${delay}ms (attempt ${attempt}/${maxRetries})\n`,
        );
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }

  private mapTools(
    serverName: string,
    rawTools: ReadonlyArray<{ name: string; description?: string | undefined; inputSchema: unknown }>,
  ): ToolCapability[] {
    return rawTools.map((t) => {
      const schema = t.inputSchema as {
        properties?: Record<string, { type?: string; description?: string }>;
        required?: string[];
      };
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      return {
        tool: mcpToolName(serverName, t.name),
        description: `[MCP:${serverName}] ${t.description ?? t.name}`,
        // Preserve the full JSON Schema for MCP-aware consumers.
        inputSchema: t.inputSchema as Record<string, unknown>,
        // Flat view for internal agents that enumerate parameters.
        parameters: Object.entries(properties).map(([name, prop]) => ({
          name,
          type: prop.type ?? "string",
          required: required.includes(name),
          ...(prop.description ? { description: prop.description } : {}),
        })),
      };
    });
  }

  /** Returns connection health for each configured MCP server. */
  healthStatus(): ReadonlyArray<{ name: string; healthy: boolean; toolCount: number }> {
    return this.servers.map((s) => ({
      name: s.name,
      healthy: s.healthy,
      toolCount: s.tools.length,
    }));
  }

  /** All discovered MCP tool capabilities, prefixed with mcp:<server>:. */
  listTools(): ReadonlyArray<ToolCapability> {
    return this.servers.flatMap((s) => s.tools);
  }

  /** Returns true if the action targets an MCP tool (starts with "mcp:"). */
  handles(action: ActionRequest): boolean {
    return action.tool.startsWith(`${MCP_PREFIX}:`);
  }

  async execute(action: ActionRequest, context: AgentContext): Promise<EventResult> {
    const parts = action.tool.split(":");
    // mcp:<serverName>:<toolName> — toolName may itself contain colons
    const serverName = parts[1];
    const toolName = parts.slice(2).join(":");

    const server = this.servers.find((s) => s.name === serverName);
    if (!server || !toolName) {
      return { output: `MCP server "${serverName}" not found`, success: false };
    }

    const start = Date.now();
    let result: EventResult;

    try {
      const response = await server.client.callTool({
        name: toolName,
        arguments: (action.parameters ?? {}) as Record<string, unknown>,
      });

      const rawContent = response.content as Array<Record<string, unknown>>;
      const content: ContentBlock[] = rawContent.map((b) => {
        if (b["type"] === "image") {
          return {
            type: "image" as const,
            data: String(b["data"] ?? ""),
            mimeType: String(b["mimeType"] ?? "application/octet-stream"),
          };
        }
        if (b["type"] === "resource_link") {
          return {
            type: "resource_link" as const,
            uri: String(b["uri"] ?? ""),
            ...(b["name"] !== undefined ? { name: String(b["name"]) } : {}),
            ...(b["description"] !== undefined ? { description: String(b["description"]) } : {}),
            ...(b["mimeType"] !== undefined ? { mimeType: String(b["mimeType"]) } : {}),
          };
        }
        // Default: treat as text block (covers "text" and any unknown types).
        return { type: "text" as const, text: String(b["text"] ?? "") };
      });

      const outputText = content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const isError = Boolean(response.isError);
      result = {
        output: outputText || "(empty response)",
        success: !isError,
        isError,
        content,
        latencyMs: Date.now() - start,
        ...(isError ? { errorCode: "MCP_TOOL_ERROR" } : {}),
      };
    } catch (err) {
      result = {
        output: err instanceof Error ? err.message : String(err),
        success: false,
        latencyMs: Date.now() - start,
        errorCode: "MCP_CALL_FAILED",
      };
    }

    // Publish tool_result ExperienceEvent so MCP responses become memory events.
    await this.publishToolResult(action, result, context);

    return result;
  }

  private async publishToolResult(
    action: ActionRequest,
    result: EventResult,
    context: AgentContext,
  ): Promise<void> {
    const event: ExperienceEvent = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "tool_result",
      context: {
        sessionId: context.sessionId,
        agentId: "mcp-bridge",
        traceId: context.traceId,
      },
      input: {
        text: `MCP tool call: ${action.tool}`,
        embedding: [],
      },
      action: {
        tool: action.tool,
        ...(action.parameters ? { parameters: action.parameters } : {}),
      },
      result,
      importanceScore: result.success ? 0.55 : 0.3,
      tags: [
        "source:mcp",
        `tool:${action.tool}`,
        result.success ? "outcome:success" : "outcome:failure",
      ],
    };

    try {
      await this.producer.publish(Topics.EXPERIENCE_RAW, event, { key: context.sessionId });
    } catch {
      // Non-fatal: if publishing fails, the tool result is still returned to the caller.
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.client.close()));
    this.servers = [];
  }
}

/** Parse MCP_SERVERS env var; returns empty array if unset or invalid. */
export function mcpServersFromEnv(): ReadonlyArray<McpServerConfig> {
  const raw = process.env["MCP_SERVERS"];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as McpServerConfig[];
  } catch {
    process.stderr.write("[mcp-bridge] Failed to parse MCP_SERVERS env var\n");
    return [];
  }
}
