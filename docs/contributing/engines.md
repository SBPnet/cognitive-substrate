# Adding a New Cognitive Engine

This guide covers the three ways to extend the substrate with new cognitive behaviour, in order of increasing integration depth:

1. **Engine plugin** -- a new `ReasoningModel` that replaces or wraps the default multi-agent debate (fastest path; no monorepo changes needed)
2. **Tool-executor plugin** -- a new `ToolExecutor` that adds tools the agent can invoke
3. **First-party engine package** -- a new cognitive stage living directly in `packages/`

## Option 1: EnginePlugin (external package)

Use this when you want to swap or augment the reasoning model without touching the monorepo.

### 1. Scaffold the package

```bash
pnpm --filter @cognitive-substrate/create-plugin scaffold
```

Follow the prompts. The scaffolder creates an npm package with the correct `package.json` (ESM, `"type": "module"`, `.js` extensions in imports) and a stub `src/index.ts`.

### 2. Implement ReasoningModel

```typescript
// src/index.ts
import type { EnginePlugin } from "@cognitive-substrate/plugin-loader";
import type { ReasoningModel, ReasoningDecision, AgentContext } from "@cognitive-substrate/agents";

class MyReasoningModel implements ReasoningModel {
  async reason(context: AgentContext): Promise<ReasoningDecision> {
    // context.memories   -- retrieved MemoryReference[]
    // context.goals      -- active Goal[]
    // context.policy     -- current PolicyState
    // context.capabilities -- available ToolCapability[]
    return {
      proposal: "...",
      reasoning: "...",
      confidence: 0.8,
      riskScore: 0.1,
      // action: { tool: "WebFetch", parameters: { url: "..." } }
    };
  }
}

const plugin: EnginePlugin = {
  kind: "engine",
  name: "my-engine",
  create: () => new MyReasoningModel(),
};

export default plugin;
```

See `docs/architecture/engine-contracts.md` for the full `ReasoningDecision` contract.

### 3. Wire it in

```bash
CS_PLUGINS=@your-org/my-engine CS_ENGINE=my-engine pnpm --filter apps/orchestrator start
```

`CS_PLUGINS` loads the package; `CS_ENGINE` selects it as the active reasoning model.

## Option 2: ToolExecutorPlugin

Use this when you want to add tools (MCP servers, REST APIs, internal actions) that agents can invoke.

### Implement ToolExecutor

```typescript
import type { ToolExecutorPlugin } from "@cognitive-substrate/plugin-loader";
import type { ToolExecutor, ToolCapability } from "@cognitive-substrate/agents";
import type { AgentContext, EventResult } from "@cognitive-substrate/core-types";

class MyToolExecutor implements ToolExecutor {
  listTools(): ReadonlyArray<ToolCapability> {
    return [{
      tool: "MyTool",
      description: "Does something useful",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    }];
  }

  async execute(action: { tool: string; parameters?: Record<string, unknown> }, context: AgentContext): Promise<EventResult> {
    if (action.tool === "MyTool") {
      // ...
      return { output: "result", success: true };
    }
    return { output: "Unknown tool", success: false, errorCode: "unknown_tool" };
  }
}

const plugin: ToolExecutorPlugin = {
  kind: "tool-executor",
  create: () => new MyToolExecutor(),
};

export default plugin;
```

Multiple tool-executor plugins are composed by `CompositeToolExecutor`. Tool names must be unique across all plugins.

## Option 3: First-party engine package

Use this when the engine needs to be a permanent part of the substrate, requires access to OpenSearch, or participates in the consolidation/decay/reinforcement pipeline.

### 1. Create the package

```bash
mkdir packages/my-engine
cd packages/my-engine
```

Create `package.json` following the pattern of an existing engine (e.g. `packages/temporal-engine/package.json`). Required fields:

```json
{
  "name": "@cognitive-substrate/my-engine",
  "type": "module",
  "exports": { ".": { "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

ESM is mandatory throughout the monorepo. Use `.js` extensions in all relative imports (even for `.ts` source files).

### 2. Implement the engine

Create `src/engine.ts` with your engine class and `src/types.ts` for its input/output types. Create `src/index.ts` re-exporting the public surface.

If the engine reads from or writes to OpenSearch, import `indexDocument`, `updateDocument`, `search` from `@cognitive-substrate/memory-opensearch`. Accept a `Client` in the constructor; inject it at runtime.

### 3. Register the stage number

Open `apps/orchestrator/src/society.ts` (the orchestrator wiring file) and add your engine to the appropriate point in the turn flow. Stage numbers are a reference to the architecture design; they don't enforce ordering in code. The orchestrator calls engines explicitly.

### 4. Write a behavioral smoke test

Create `src/__tests__/engine.test.ts`. Follow the pattern from any existing engine test. A behavioral test:

- Seeds a small set of `ExperienceEvent` or `SemanticMemory` fixtures
- Runs the engine
- Asserts on the output shape and signal direction (not exact values)

A good smoke test uses `vitest` and requires no live OpenSearch. Use mock clients or in-memory fixtures for unit tests; reserve live-index tests for the `experiment-corpus`.

```bash
pnpm --filter @cognitive-substrate/my-engine test
```

### 5. Update the package map

Add a row to `docs/architecture/package-map.md` with the package name, stage number, one-line purpose, and key entry point.

### 6. Add an experiment (recommended)

If the engine introduces a new architectural claim (a hypothesis that can be confirmed or disconfirmed), add an experiment to `packages/experiment-corpus`. See `docs/experiments.md` for the experiment format.

## Checklist

- [ ] `package.json` has `"type": "module"` and exports map pointing to `dist/`
- [ ] All relative imports use `.js` extensions
- [ ] `pnpm build` succeeds
- [ ] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm lint` passes (zero warnings; no em-dashes in comments or strings)
- [ ] A behavioral smoke test exists and passes
- [ ] Row added to `docs/architecture/package-map.md`
