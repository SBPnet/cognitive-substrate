# Plugin Development Guide

The cognitive-substrate plugin system lets you extend three parts of the runtime without touching the orchestrator or ingest-worker source code:

| Plugin kind | What it does |
|---|---|
| `ingest-mapper` | Handles new raw event types arriving from Kafka and maps them to `ExperienceEvent` |
| `engine` | Provides a custom `ReasoningModel` implementation (LLM, rule-based, etc.) |
| `tool-executor` | Adds new tools the cognitive loop can call during a session |

Every plugin is a normal pnpm workspace package. It exports one named constant and is activated with a single environment variable.

---

## How it works

At startup, both the orchestrator and the ingest-worker read the `CS_PLUGINS` environment variable:

```
CS_PLUGINS=@my-org/cs-plugin-github-events,@my-org/cs-plugin-gpt4o
```

Each name is a bare package specifier. The loader calls `await import(name)` on each, validates the exported `plugin` object, and wires it into the appropriate slot. If any plugin fails to import or export a valid manifest, the process exits immediately — broken plugins never degrade silently.

---

## Package structure

Every plugin follows the same layout. Place it anywhere covered by the pnpm workspace glob (`packages/*` or `apps/workers/*`):

```
packages/cs-plugin-<name>/
  package.json
  tsconfig.json
  src/
    index.ts        ← exports `plugin`
```

### `package.json`

```json
{
  "name": "@cognitive-substrate/cs-plugin-<name>",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@cognitive-substrate/core-types": "workspace:*"
  },
  "devDependencies": {
    "@cognitive-substrate/plugin-loader": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0"
  }
}
```

> `@cognitive-substrate/plugin-loader` is a dev dependency — you only need it for the TypeScript types. `@cognitive-substrate/core-types` is a runtime dependency if your mapper references `ExperienceEvent`.

### `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src"]
}
```

---

## Plugin kinds

### 1. Ingest mapper

An ingest-mapper plugin claims one or more `event.type` strings from the Kafka message stream and converts them to `ExperienceEvent` objects for the memory pipeline.

**When to use:** You have a new data source (GitHub webhooks, IoT sensors, Stripe events, etc.) that publishes messages to the `telemetry.logs.raw` Kafka topic with a type string not already handled by the built-in mapper.

**Interface:**

```typescript
interface IngestMapperPlugin {
  readonly kind: "ingest-mapper";
  readonly handles: ReadonlyArray<string>; // the event.type values this plugin owns
  map(event: unknown): ExperienceEvent | null;
}
```

`map()` receives the raw Kafka message value (typed as `unknown` — you own the type guard). Return a fully-populated `ExperienceEvent` or `null` to silently skip the event.

**`importanceScore` guidance:**

| Signal strength | Range |
|---|---|
| Strong intent (purchase, commit, completion) | 0.75 – 1.0 |
| Active engagement (click, search, deep interaction) | 0.50 – 0.75 |
| Passive signal (view, hover, low-depth scroll) | 0.10 – 0.40 |

**Example — GitHub push events:**

```typescript
// src/index.ts
import { randomUUID } from "node:crypto";
import type { ExperienceEvent, EventContext } from "@cognitive-substrate/core-types";
import type { IngestMapperPlugin } from "@cognitive-substrate/plugin-loader";

interface GitHubPushEvent {
  type: "github_push";
  sessionId: string;
  timestamp: string;
  payload: {
    repository: string;
    branch: string;
    commitCount: number;
    author: string;
    message: string;
  };
}

function isGitHubPushEvent(ev: unknown): ev is GitHubPushEvent {
  return (
    typeof ev === "object" &&
    ev !== null &&
    (ev as { type?: unknown }).type === "github_push"
  );
}

export const plugin: IngestMapperPlugin = {
  kind: "ingest-mapper",
  handles: ["github_push"],

  map(event: unknown): ExperienceEvent | null {
    if (!isGitHubPushEvent(event)) return null;

    const { payload } = event;

    // Skip noise — single-commit pushes to non-main branches have low signal
    if (payload.commitCount === 1 && payload.branch !== "main") return null;

    const context: EventContext = {
      sessionId: event.sessionId,
      agentId: "cs-plugin-github",
    };

    return {
      eventId: randomUUID(),
      timestamp: event.timestamp,
      type: "environmental_observation",
      context,
      input: {
        text: `${payload.author} pushed ${payload.commitCount} commit(s) to ${payload.repository}@${payload.branch}: "${payload.message}"`,
        embedding: [], // generated by OpenSearch ingest pipeline at index time
      },
      importanceScore: payload.branch === "main" ? 0.80 : 0.55,
      tags: [
        "source:github",
        `event:github_push`,
        `repo:${payload.repository}`,
        `branch:${payload.branch}`,
        payload.branch === "main" ? "engagement:deep" : "engagement:shallow",
      ],
    };
  },
};
```

**Activation:**

```bash
pnpm --filter @cognitive-substrate/cs-plugin-github build
CS_PLUGINS=@cognitive-substrate/cs-plugin-github pnpm --filter @cognitive-substrate/ingest-worker start
```

---

**Example — multiple event types in one plugin:**

A single plugin can own several related event types. Declare all of them in `handles`:

```typescript
export const plugin: IngestMapperPlugin = {
  kind: "ingest-mapper",
  handles: ["stripe_payment_succeeded", "stripe_payment_failed", "stripe_refund_issued"],

  map(event: unknown): ExperienceEvent | null {
    const ev = event as { type: string; sessionId: string; timestamp: string; payload: Record<string, unknown> };

    switch (ev.type) {
      case "stripe_payment_succeeded":
        return {
          eventId: randomUUID(),
          timestamp: ev.timestamp,
          type: "environmental_observation",
          context: { sessionId: ev.sessionId, agentId: "cs-plugin-stripe" },
          input: {
            text: `Payment succeeded: $${String(ev.payload["amount"])} ${String(ev.payload["currency"])}`,
            embedding: [],
          },
          importanceScore: 0.90,
          tags: ["source:stripe", "event:payment_succeeded", "engagement:conversion"],
        };

      case "stripe_payment_failed":
        return {
          eventId: randomUUID(),
          timestamp: ev.timestamp,
          type: "environmental_observation",
          context: { sessionId: ev.sessionId, agentId: "cs-plugin-stripe" },
          input: {
            text: `Payment failed: ${String(ev.payload["failure_message"])}`,
            embedding: [],
          },
          importanceScore: 0.85,
          tags: ["source:stripe", "event:payment_failed", "engagement:exit"],
        };

      case "stripe_refund_issued":
        return {
          eventId: randomUUID(),
          timestamp: ev.timestamp,
          type: "environmental_observation",
          context: { sessionId: ev.sessionId, agentId: "cs-plugin-stripe" },
          input: {
            text: `Refund issued: $${String(ev.payload["amount"])}`,
            embedding: [],
          },
          importanceScore: 0.70,
          tags: ["source:stripe", "event:refund_issued"],
        };

      default:
        return null;
    }
  },
};
```

---

### 2. Engine (reasoning model)

An engine plugin provides a custom `ReasoningModel` — the component that decides what the cognitive loop should propose and do next.

**When to use:** You want to use an LLM provider not covered by the built-in chain (e.g., Mistral, Gemini, a fine-tuned model endpoint), or you want to run a deterministic/rule-based reasoner for testing.

**Interface:**

```typescript
interface EnginePlugin {
  readonly kind: "engine";
  readonly name: string;    // matched by CS_ENGINE env var
  create(): ReasoningModel;
}

// ReasoningModel (from @cognitive-substrate/agents):
interface ReasoningModel {
  reason(context: AgentContext): Promise<ReasoningDecision>;
}

// ReasoningDecision:
interface ReasoningDecision {
  readonly proposal: string;
  readonly reasoning?: string;
  readonly confidence: number;  // 0–1
  readonly riskScore: number;   // 0–1, higher = riskier
  readonly action?: {
    readonly tool: string;
    readonly parameters?: Record<string, unknown>;
  };
}
```

**Example — Mistral via OpenAI-compatible API:**

```typescript
// src/index.ts
import type { ReasoningModel, ReasoningDecision } from "@cognitive-substrate/agents";
import type { AgentContext } from "@cognitive-substrate/core-types";
import type { EnginePlugin } from "@cognitive-substrate/plugin-loader";

class MistralReasoningModel implements ReasoningModel {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const baseURL = process.env["MISTRAL_BASE_URL"];
    const apiKey = process.env["MISTRAL_API_KEY"];
    if (!baseURL || !apiKey) {
      throw new Error(
        "[cs-plugin-mistral] MISTRAL_BASE_URL and MISTRAL_API_KEY must be set",
      );
    }
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.model = process.env["MISTRAL_MODEL"] ?? "mistral-large-latest";
  }

  async reason(context: AgentContext): Promise<ReasoningDecision> {
    const systemPrompt = [
      "You are a cognitive agent. Based on the session context and retrieved memories,",
      "propose a concise action or response. Reply in JSON:",
      '{ "proposal": "...", "reasoning": "...", "confidence": 0.0–1.0, "riskScore": 0.0–1.0 }',
    ].join(" ");

    const userMessage = [
      `Session: ${context.session.sessionId}`,
      `Active goals: ${context.goals.map((g) => g.description).join(", ") || "none"}`,
      `Memories: ${context.memories.map((m) => m.summary).slice(0, 5).join(" | ")}`,
    ].join("\n");

    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`[cs-plugin-mistral] API error: ${response.status}`);
    }

    const json = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<ReasoningDecision>;

    return {
      proposal: parsed.proposal ?? "",
      reasoning: parsed.reasoning,
      confidence: parsed.confidence ?? 0.5,
      riskScore: parsed.riskScore ?? 0.5,
    };
  }
}

export const plugin: EnginePlugin = {
  kind: "engine",
  name: "mistral",
  create: () => new MistralReasoningModel(),
};
```

**Activation:**

```bash
pnpm --filter @cognitive-substrate/cs-plugin-mistral build

CS_PLUGINS=@cognitive-substrate/cs-plugin-mistral \
CS_ENGINE=mistral \
MISTRAL_API_KEY=sk-... \
MISTRAL_BASE_URL=https://api.mistral.ai \
pnpm --filter @cognitive-substrate/orchestrator start
```

`CS_ENGINE` must match the `name` field exactly. If `CS_ENGINE` is set but no loaded plugin declares that name, the orchestrator exits with an error listing the available names.

If `CS_ENGINE` is not set, the plugin is loaded but not used — the built-in env chain (Ollama → OpenAI → Claude → MultiAgent) applies as normal.

---

**Example — deterministic test stub:**

Useful for integration tests or development without a live LLM:

```typescript
import type { EnginePlugin } from "@cognitive-substrate/plugin-loader";
import type { ReasoningModel } from "@cognitive-substrate/agents";
import type { AgentContext } from "@cognitive-substrate/core-types";

const echoModel: ReasoningModel = {
  async reason(context: AgentContext) {
    const topMemory = context.memories[0]?.summary ?? "no memories";
    return {
      proposal: `Echo: ${topMemory}`,
      confidence: 1.0,
      riskScore: 0.0,
    };
  },
};

export const plugin: EnginePlugin = {
  kind: "engine",
  name: "echo",
  create: () => echoModel,
};
```

---

### 3. Tool executor

A tool-executor plugin adds new tools the cognitive loop can invoke during a session. The model sees these tools listed in its context and can call them via `action.tool`.

**When to use:** You want to give the agent the ability to call an external service — a database, an internal API, a third-party integration — that isn't covered by the built-in tool surface (web fetch, memory search, write experience) or MCP.

**Interface:**

```typescript
interface ToolExecutorPlugin {
  readonly kind: "tool-executor";
  create(): ToolExecutor | Promise<ToolExecutor>;
}

// ToolExecutor (from @cognitive-substrate/agents):
interface ToolExecutor {
  listTools(): ReadonlyArray<ToolCapability>;
  execute(action: ActionRequest, context: AgentContext): Promise<EventResult>;
}

// ToolCapability (from @cognitive-substrate/core-types):
interface ToolCapability {
  readonly tool: string;                    // unique tool name
  readonly description?: string;            // shown to the reasoning model
  readonly parameters?: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly description?: string;
  }>;
}

// EventResult (returned from execute):
interface EventResult {
  readonly output: string;   // text the model can read
  readonly success: boolean;
  readonly latencyMs?: number;
  readonly errorCode?: string;
}
```

**Example — internal knowledge base search:**

```typescript
// src/index.ts
import type { ToolExecutorPlugin } from "@cognitive-substrate/plugin-loader";
import type { ToolExecutor, ActionRequest } from "@cognitive-substrate/agents";
import type { AgentContext, EventResult, ToolCapability } from "@cognitive-substrate/core-types";

class KnowledgeBaseExecutor implements ToolExecutor {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  listTools(): ReadonlyArray<ToolCapability> {
    return [
      {
        tool: "knowledge_base_search",
        description: "Search the internal company knowledge base for documentation, runbooks, and policies.",
        parameters: [
          { name: "query", type: "string", required: true, description: "Search query" },
          { name: "limit", type: "number", required: false, description: "Max results (default 5)" },
        ],
      },
      {
        tool: "knowledge_base_get",
        description: "Retrieve a specific knowledge base article by ID.",
        parameters: [
          { name: "articleId", type: "string", required: true },
        ],
      },
    ];
  }

  async execute(action: ActionRequest, _context: AgentContext): Promise<EventResult> {
    const start = Date.now();

    try {
      switch (action.tool) {
        case "knowledge_base_search": {
          const query = String(action.parameters?.["query"] ?? "");
          const limit = Number(action.parameters?.["limit"] ?? 5);
          const res = await fetch(`${this.endpoint}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
          const data = await res.json() as { results: Array<{ title: string; summary: string }> };
          const output = data.results.map((r) => `• ${r.title}: ${r.summary}`).join("\n");
          return { output: output || "No results found.", success: true, latencyMs: Date.now() - start };
        }

        case "knowledge_base_get": {
          const articleId = String(action.parameters?.["articleId"] ?? "");
          const res = await fetch(`${this.endpoint}/articles/${articleId}`);
          if (!res.ok) {
            return { output: `Article ${articleId} not found.`, success: false, latencyMs: Date.now() - start };
          }
          const data = await res.json() as { title: string; content: string };
          return { output: `${data.title}\n\n${data.content}`, success: true, latencyMs: Date.now() - start };
        }

        default:
          return {
            output: `Unknown tool: ${action.tool}`,
            success: false,
            errorCode: "UNKNOWN_TOOL",
            latencyMs: Date.now() - start,
          };
      }
    } catch (err) {
      return {
        output: (err as Error).message,
        success: false,
        errorCode: "TOOL_ERROR",
        latencyMs: Date.now() - start,
      };
    }
  }
}

export const plugin: ToolExecutorPlugin = {
  kind: "tool-executor",

  async create(): Promise<ToolExecutor> {
    const endpoint = process.env["KB_ENDPOINT"];
    if (!endpoint) throw new Error("[cs-plugin-kb] KB_ENDPOINT must be set");

    // Verify connectivity before the loop starts
    await fetch(`${endpoint}/health`).catch(() => {
      throw new Error(`[cs-plugin-kb] Knowledge base at ${endpoint} is unreachable`);
    });

    return new KnowledgeBaseExecutor(endpoint);
  },
};
```

**Activation:**

```bash
pnpm --filter @cognitive-substrate/cs-plugin-kb build

CS_PLUGINS=@cognitive-substrate/cs-plugin-kb \
KB_ENDPOINT=http://kb.internal \
pnpm --filter @cognitive-substrate/orchestrator start
```

---

## Using multiple plugins together

`CS_PLUGINS` accepts a comma-separated list. All plugins load in order; the ingest mapper registry registers built-in types first so plugins cannot shadow them.

```bash
CS_PLUGINS=@my-org/cs-plugin-github,@my-org/cs-plugin-stripe,@my-org/cs-plugin-kb \
CS_ENGINE=mistral \
MISTRAL_API_KEY=sk-... \
KB_ENDPOINT=http://kb.internal \
pnpm --filter @cognitive-substrate/orchestrator start
```

Startup output:

```
[plugin-loader] Loaded ingest-mapper plugin: @my-org/cs-plugin-github
[plugin-loader] Loaded ingest-mapper plugin: @my-org/cs-plugin-stripe
[plugin-loader] Loaded tool-executor plugin: @my-org/cs-plugin-kb
```

---

## Constraints and rules

**Event type ownership is exclusive.** Two plugins cannot claim the same `event.type` string. The registry throws on the second registration. Built-in types (`page_view`, `article_complete`, `scroll_depth`, etc.) are always registered first and cannot be overridden.

**Fail loudly.** A plugin that throws from `create()` or `map()` propagates the error up. If `create()` throws, the process exits before serving any traffic. If `map()` throws on a message, that message is surfaced as a consumer error — handle expected failures by returning `null` instead.

**No hot-reload.** Node's ESM module cache means a second `import()` of the same specifier returns the cached module. To update a plugin, rebuild it and restart the process.

**Always use bare specifiers.** The `CS_PLUGINS` list takes package names (`@my-org/pkg`), not file paths. pnpm workspace symlinks route the import through `node_modules`. File paths would break if the workspace layout changes.

**Build before activating.** Plugins must be compiled to `dist/` before the runtime imports them. The runtime imports `dist/index.js` — not the TypeScript source.

```bash
pnpm --filter @my-org/cs-plugin-github build
```

Or build all workspace packages at once:

```bash
pnpm build
```

**`embedding` must be an empty array.** The OpenSearch ingest pipeline generates embeddings from `input.text` at index time. Set `embedding: []` in every `ExperienceEvent` you return — never attempt to compute embeddings client-side in a plugin.

---

## Checklist for a new plugin

- [ ] Package lives under `packages/` or `apps/workers/` (covered by pnpm workspace glob)
- [ ] `"type": "module"` in `package.json`
- [ ] `exports["."].import` points to `./dist/index.js`
- [ ] `tsconfig.json` extends `../../tsconfig.base.json`
- [ ] `src/index.ts` exports `const plugin: CognitiveSubstratePlugin`
- [ ] `kind` is one of `"ingest-mapper"`, `"engine"`, `"tool-executor"`
- [ ] Package is built (`pnpm --filter <name> build`) before activating
- [ ] Package name added to `CS_PLUGINS` environment variable
- [ ] If `kind: "engine"`, `CS_ENGINE=<plugin.name>` is also set
- [ ] `embedding: []` in all returned `ExperienceEvent` objects
