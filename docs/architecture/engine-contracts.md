# Engine Contracts

This document defines the three plugin interfaces and the conventions all engine implementations must follow.

## Plugin kinds

There are three plugin kinds, declared in `packages/plugin-loader/src/types.ts`:

| Kind | Interface | Selected by |
|------|-----------|------------|
| `"ingest-mapper"` | `IngestMapperPlugin` | `event.type` match |
| `"engine"` | `EnginePlugin` | `CS_ENGINE=<name>` env var |
| `"tool-executor"` | `ToolExecutorPlugin` | always loaded |

A plugin package exports a default export conforming to `CognitiveSubstratePlugin`.

## IngestMapperPlugin

```typescript
interface IngestMapperPlugin {
  readonly kind: "ingest-mapper";
  readonly handles: ReadonlyArray<string>;  // event.type strings this plugin owns
  map(event: unknown): ExperienceEvent | null;
  createWebhookRouter?(getProducer: () => CognitiveProducer | null): Hono;
}
```

**`handles`**: must be globally unique across all loaded plugins. The ingest worker dispatches raw events to the first plugin whose `handles` array contains the event's `type` field.

**`map`**: receives an untyped raw event (Kafka message payload). Return a complete `ExperienceEvent` or `null` to silently drop the event. Throw to surface a hard failure that will be logged and increment the dead-letter counter.

**`createWebhookRouter`** (optional): contribute an HTTP receiver mounted at `/api/webhooks/<handle>`. The router should publish received payloads onto the `telemetry.logs.raw` topic using the provided `CognitiveProducer`. The API server mounts each router automatically -- no changes to `server.ts` needed.

**`importanceScore`**: the mapper is responsible for setting this field on every returned `ExperienceEvent`. It is the primary signal for retrieval ranking and decay decisions. Range: `[0, 1]`. Use operational severity, user-feedback signals, or content-based heuristics as inputs.

## EnginePlugin

```typescript
interface EnginePlugin {
  readonly kind: "engine";
  readonly name: string;
  create(): ReasoningModel;
  shutdown?(): Promise<void>;
}
```

The `ReasoningModel` interface is defined in `packages/agents/src/types.ts`:

```typescript
interface ReasoningModel {
  reason(context: AgentContext): Promise<ReasoningDecision>;
}

interface ReasoningDecision {
  readonly proposal: string;
  readonly reasoning?: string;
  readonly confidence: number;   // [0, 1]
  readonly riskScore: number;    // [0, 1]
  readonly action?: { tool: string; parameters?: Record<string, unknown> };
}
```

**`proposal`**: the agent's proposed response text. Must be non-empty.

**`confidence`**: the agent's own estimate of correctness. Fed into the policy evaluation `rewardDelta` (`+confidence` on success, `-riskScore` on failure) and arbitration scoring (30% weight).

**`riskScore`**: estimated risk of the proposed action. High riskScore reduces arbitration score (20% weight as penalty) and drives `explorationFactor` downward in the policy engine.

**`action`** (optional): the tool to invoke. When present, `ToolExecutor.execute` is called before the policy evaluation step. The `tool` name must match one of the `ToolCapability.tool` values in `AgentContext.capabilities`.

**`shutdown`** (optional): called by the orchestrator on SIGINT/SIGTERM. Close LLM connections, flush queues, or release resources here.

## ToolExecutorPlugin

```typescript
interface ToolExecutorPlugin {
  readonly kind: "tool-executor";
  create(): ToolExecutor | Promise<ToolExecutor>;
  shutdown?(): Promise<void>;
}
```

The `ToolExecutor` interface is in `packages/agents/src/types.ts`:

```typescript
interface ToolExecutor {
  execute(action: ActionRequest, context: AgentContext): Promise<EventResult>;
  listTools(): ReadonlyArray<ToolCapability>;
}
```

**`listTools`**: returns the tools this executor can dispatch. Called once per cognitive turn at context-build time and injected into `AgentContext.capabilities`. Agents use this list to scope proposals to available tools. Return an empty array if this executor has no declared surface.

**`execute`**: dispatches one tool call. Returns `EventResult`:

```typescript
interface EventResult {
  readonly output: string;      // flat text output
  readonly success: boolean;
  readonly latencyMs?: number;
  readonly errorCode?: string;
  readonly content?: ContentBlock[];  // MCP-compatible structured content
  readonly isError?: boolean;
}
```

Tool names are routed by prefix in `CompositeToolExecutor` -- the first executor whose `listTools()` includes the requested tool name wins. Duplicate tool names across plugins resolve to the first match; avoid overlap.

## ToolCapability shape

```typescript
interface ToolCapability {
  readonly tool: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;  // JSON Schema (MCP wire format)
  readonly parameters?: Array<{                    // flat list for simple tools
    name: string; type: string; required: boolean; description?: string;
  }>;
}
```

Prefer `inputSchema` (JSON Schema) for complex or nested parameters; `parameters` is a convenience shortcut for simple tools. The cognitive loop injects the full list into every `AgentContext` so LLM-backed agents can reason about what is available.

## Error handling conventions

- **`IngestMapperPlugin.map`**: return `null` for expected drops (filtered events, schema mismatches); throw for unexpected failures. The ingest worker catches throws and increments a dead-letter counter without crashing.
- **`ReasoningModel.reason`**: throw on unrecoverable failures (LLM API error, timeout). The orchestrator catches, logs, and publishes a `status: "failed"` `InteractionResponseEvent`. Do not swallow errors silently.
- **`ToolExecutor.execute`**: return `{ success: false, output: "...", errorCode: "..." }` for expected tool failures (network error, invalid params). Throw only for programmer errors (missing required state). The loop treats `success: false` as a handled failure and adjusts the policy evaluation delta accordingly (`-riskScore` instead of `+confidence`).

## Telemetry conventions

Each engine is expected to produce OpenTelemetry spans. Use semantic conventions from `packages/telemetry-otel`:

- Span name: `cog.<engine-name>.<operation>` (e.g. `cog.reasoning.reason`, `cog.retrieval.hybrid-query`)
- Attribute: `cog.session_id`, `cog.trace_id`, `cog.memory_id` where applicable
- Record errors on the span with `span.recordException(error)` before re-throwing

The OTel tracer is available via `import { tracer } from "@cognitive-substrate/telemetry-otel"`.

## Loading mechanism

Plugins are loaded at orchestrator startup by `loadPluginsFromEnv` (`packages/plugin-loader/src/loader.ts`). The `CS_PLUGINS` environment variable accepts a comma-separated list of bare npm specifiers:

```
CS_PLUGINS=@cognitive-substrate/plugin-aiven,@your-org/plugin-slack
```

Each specifier is dynamically imported. The default export must be a `CognitiveSubstratePlugin` (or an array of them). Plugin packages are resolved from the process `node_modules`.

`CS_ENGINE` selects which loaded `EnginePlugin` to use as the reasoning model. If unset, the orchestrator uses the default `MultiAgentReasoningModel` backed by `createDefaultAgents`.
