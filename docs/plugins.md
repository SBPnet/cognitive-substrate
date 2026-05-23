# Plugin Guide

The cognitive-substrate plugin system extends three parts of the runtime without touching core source:

| Kind | What it does |
|---|---|
| `ingest-mapper` | Claims raw event types from Kafka and maps them to `ExperienceEvent` objects. Optionally contributes a webhook receiver so an external service can push events directly to the API. |
| `engine` | Provides a custom `ReasoningModel` (LLM, rule-based, etc.) selected by `CS_ENGINE`. |
| `tool-executor` | Adds tools the cognitive loop can call during a session. |

---

## How plugins load

At startup, the API, the orchestrator, and the ingest-worker all read `CS_PLUGINS`:

```
CS_PLUGINS=@cognitive-substrate/plugin-slack,@cognitive-substrate/plugin-jira
```

The value is a comma-separated list of **bare npm package specifiers**. The loader calls `await import(name)` on each, validates the exported `plugin` object, and wires it into the appropriate slot. If any plugin fails to import or export a valid manifest, the process exits immediately -- broken plugins never degrade silently.

Startup output confirms what loaded:

```
[plugin-loader] Loaded ingest-mapper plugin: @cognitive-substrate/plugin-slack
[plugin-loader] Loaded ingest-mapper plugin: @cognitive-substrate/plugin-jira
```

---

## Two models: monorepo vs. external repo

Plugins can live inside the monorepo or in their own independent repositories. Choose based on how tightly coupled the plugin is to the core system.

### Model A: inside the monorepo (workspace plugin)

Use this when the plugin is tightly coupled to core type changes or is only ever used by this deployment.

Place the package anywhere covered by the pnpm workspace glob (`packages/*` or `apps/workers/*`):

```
packages/plugin-<name>/
  package.json    ← workspace:* deps, extends ../../tsconfig.base.json
  tsconfig.json
  src/index.ts
```

`package.json` declares workspace deps:

```json
{
  "dependencies": {
    "@cognitive-substrate/core-types": "workspace:*",
    "@cognitive-substrate/plugin-loader": "workspace:*"
  }
}
```

Build before activating:

```bash
pnpm --filter @my-org/plugin-name build
```

pnpm workspace symlinks handle resolution -- the bare package specifier in `CS_PLUGINS` resolves through `node_modules` without any path configuration.

### Model B: external repo (independent plugin)

Use this when the plugin is developed independently, versioned separately, or shared across deployments. This is the model used by the official first-party plugins (`plugin-slack`, `plugin-zendesk`, `plugin-jira`).

The plugin lives in its own git repo (e.g. `~/Workspace/cognitive-substrate-plugin-slack`). Its `package.json` declares peer deps instead of workspace deps:

```json
{
  "peerDependencies": {
    "@cognitive-substrate/core-types": "^0.1.0",
    "@cognitive-substrate/kafka-bus": "^0.1.0",
    "@cognitive-substrate/plugin-loader": "^0.1.0",
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cognitive-substrate/core-types": "^0.1.0",
    "@cognitive-substrate/kafka-bus": "^0.1.0",
    "@cognitive-substrate/plugin-loader": "^0.1.0",
    "@types/node": "^22.0.0",
    "hono": "^4.6.14",
    "typescript": "^5.5.0"
  }
}
```

Peer deps are provided by the host application at runtime -- you only need dev deps listed to typecheck and build the plugin itself.

---

## How the deployment finds external plugins

Node resolves `import(name)` by searching `node_modules` relative to the importing file. So **the plugin must be installed in the deployment's `node_modules`** before the process starts. There are two ways to do this:

### Option 1: npm install (recommended for production)

If the plugin is published to npm (public or private registry), add it to the service's `package.json` as a regular dependency:

```json
{
  "dependencies": {
    "@cognitive-substrate/plugin-slack": "^0.1.0",
    "@cognitive-substrate/plugin-jira": "^0.1.0"
  }
}
```

Then `npm install` / `pnpm install` installs it alongside everything else. Set `CS_PLUGINS` in the deployment environment and no other config is needed.

### Option 2: local path (for development)

When developing a plugin locally before publishing, add it to this monorepo's `pnpm-workspace.yaml` temporarily:

```yaml
packages:
  - "packages/*"
  - "apps/*"
  - "apps/workers/*"
  - "../cognitive-substrate-plugin-slack"   # local checkout
```

Then `pnpm install` creates a workspace symlink and the bare specifier resolves as normal. Remove the entry and run `pnpm install` again when you publish the package and switch to `npm install`.

### Setting `CS_PLUGINS` in each service

Every service that needs the plugin must have `CS_PLUGINS` set. The ingest-worker uses it to register mappers; the API uses it to mount webhook routes. They can be set independently if you only need one side.

**Docker Compose:**

```yaml
services:
  ingest-worker:
    environment:
      CS_PLUGINS: "@cognitive-substrate/plugin-slack,@cognitive-substrate/plugin-jira"

  api:
    environment:
      CS_PLUGINS: "@cognitive-substrate/plugin-slack,@cognitive-substrate/plugin-jira"
      SLACK_SIGNING_SECRET: "your-slack-signing-secret"
      JIRA_WEBHOOK_SECRET: "your-jira-token"
```

**Kubernetes:**

```yaml
env:
  - name: CS_PLUGINS
    value: "@cognitive-substrate/plugin-slack,@cognitive-substrate/plugin-jira"
  - name: SLACK_SIGNING_SECRET
    valueFrom:
      secretKeyRef:
        name: slack-credentials
        key: signing-secret
```

---

## Plugin kinds

### 1. Ingest mapper

Claims one or more `event.type` strings from `telemetry.logs.raw` and converts them to `ExperienceEvent` objects. Optionally provides a webhook receiver.

```typescript
interface IngestMapperPlugin {
  readonly kind: "ingest-mapper";
  readonly handles: ReadonlyArray<string>;
  map(event: unknown): ExperienceEvent | null;
  // optional: contribute a Hono router mounted at /api/webhooks/<handles[0]>
  createWebhookRouter?(getProducer: () => CognitiveProducer | null): Hono;
}
```

`map()` receives the raw Kafka message value. Return a fully-populated `ExperienceEvent` or `null` to silently skip the event. Throw to surface a hard failure.

`createWebhookRouter()` is called by the API at startup if the function is present. The router is mounted at `/api/webhooks/<handles[0]>`. The `getProducer` getter returns the shared `CognitiveProducer` connected to Kafka -- use it to publish raw events to `Topics.TELEMETRY_LOGS_RAW`, which the ingest-worker will then pick up and pass through `map()`.

**`importanceScore` guidance:**

| Signal strength | Range |
|---|---|
| Strong intent (purchase, commit, completion) | 0.75 - 1.0 |
| Active engagement (click, search, interaction) | 0.50 - 0.75 |
| Passive signal (view, hover, low-depth scroll) | 0.10 - 0.40 |

**`embedding` must always be an empty array.** The OpenSearch ingest pipeline generates embeddings from `input.text` at index time. Never compute embeddings in a plugin.

**Example -- GitHub push events (mapper only, no webhook receiver):**

```typescript
import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { IngestMapperPlugin } from "@cognitive-substrate/plugin-loader";

interface GitHubPushEvent {
  type: "github_push";
  sessionId: string;
  timestamp: string;
  repository: string;
  branch: string;
  commitCount: number;
  message: string;
}

function isGitHubPushEvent(ev: unknown): ev is GitHubPushEvent {
  return typeof ev === "object" && ev !== null && (ev as { type?: unknown }).type === "github_push";
}

export const plugin: IngestMapperPlugin = {
  kind: "ingest-mapper",
  handles: ["github_push"],

  map(event: unknown): ExperienceEvent | null {
    if (!isGitHubPushEvent(event)) return null;
    if (event.commitCount === 1 && event.branch !== "main") return null;

    return {
      eventId: randomUUID(),
      timestamp: event.timestamp,
      type: "environmental_observation",
      context: { sessionId: event.sessionId, agentId: "plugin-github" },
      input: {
        text: `${event.commitCount} commit(s) pushed to ${event.repository}@${event.branch}: "${event.message}"`,
        embedding: [],
      },
      importanceScore: event.branch === "main" ? 0.80 : 0.55,
      tags: ["source:github", `repo:${event.repository}`, `branch:${event.branch}`],
    };
  },
};
```

**Example -- with a webhook receiver:**

```typescript
import { Hono } from "hono";
import { Topics } from "@cognitive-substrate/kafka-bus";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { IngestMapperPlugin } from "@cognitive-substrate/plugin-loader";
// ... map() implementation as above ...

export const plugin: IngestMapperPlugin = {
  kind: "ingest-mapper",
  handles: ["github_push"],
  map,

  createWebhookRouter(getProducer: () => CognitiveProducer | null): Hono {
    const router = new Hono();

    router.post("/", async (c) => {
      const producer = getProducer();
      if (!producer) return c.json({ error: "not ready" }, 503);

      const body = await c.req.json<{ ref: string; repository: { full_name: string }; commits: unknown[] }>();
      const branch = body.ref.replace("refs/heads/", "");
      const sessionId = `github:${body.repository.full_name}:${branch}`;

      await producer.publish(Topics.TELEMETRY_LOGS_RAW, {
        type: "github_push",
        sessionId,
        timestamp: new Date().toISOString(),
        repository: body.repository.full_name,
        branch,
        commitCount: body.commits.length,
        message: "(from webhook)",
      }, { key: sessionId });

      return c.json({ received: true });
    });

    return router;
  },
};
```

The API mounts this at `POST /api/webhooks/github_push`. No changes to `server.ts` required.

**Multiple event types in one plugin:**

```typescript
export const plugin: IngestMapperPlugin = {
  kind: "ingest-mapper",
  handles: ["stripe_payment_succeeded", "stripe_payment_failed"],
  map(event: unknown): ExperienceEvent | null {
    const ev = event as { type: string; [k: string]: unknown };
    switch (ev.type) {
      case "stripe_payment_succeeded": return mapPaymentSucceeded(ev);
      case "stripe_payment_failed":    return mapPaymentFailed(ev);
      default: return null;
    }
  },
};
```

When a plugin handles multiple types, `createWebhookRouter` (if present) is mounted under `handles[0]`. Design the receiver to route internally by event type if the upstream service sends multiple event shapes to one endpoint.

---

### 2. Engine (reasoning model)

Provides a custom `ReasoningModel` selected when `CS_ENGINE` matches the plugin's `name`.

```typescript
interface EnginePlugin {
  readonly kind: "engine";
  readonly name: string;
  create(): ReasoningModel;
}
```

**Activation requires two env vars:** `CS_PLUGINS` (to load the package) and `CS_ENGINE` (to select it by name). If `CS_ENGINE` is not set, the built-in engine chain applies even if an engine plugin is loaded.

**Example -- Mistral:**

```typescript
import type { EnginePlugin } from "@cognitive-substrate/plugin-loader";

export const plugin: EnginePlugin = {
  kind: "engine",
  name: "mistral",
  create: () => new MistralReasoningModel(),
};
```

```bash
CS_PLUGINS=@my-org/plugin-mistral \
CS_ENGINE=mistral \
MISTRAL_API_KEY=sk-... \
node dist/main.js
```

---

### 3. Tool executor

Adds tools the cognitive loop can invoke during a session.

```typescript
interface ToolExecutorPlugin {
  readonly kind: "tool-executor";
  create(): ToolExecutor | Promise<ToolExecutor>;
}
```

`create()` is called once at startup. Throw from `create()` if required configuration is missing -- the process will exit before serving traffic, which is the right behavior.

**Example:**

```typescript
export const plugin: ToolExecutorPlugin = {
  kind: "tool-executor",
  async create(): Promise<ToolExecutor> {
    const endpoint = process.env["KB_ENDPOINT"];
    if (!endpoint) throw new Error("[plugin-kb] KB_ENDPOINT must be set");
    return new KnowledgeBaseExecutor(endpoint);
  },
};
```

---

## Using multiple plugins

`CS_PLUGINS` is comma-separated. Order matters only for event type conflict detection -- built-in types are registered first and plugins are registered left-to-right:

```bash
CS_PLUGINS=@cognitive-substrate/plugin-slack,@cognitive-substrate/plugin-jira,@my-org/plugin-kb
```

Each plugin must be installed in `node_modules` of the service running it. Mixed sources work fine -- you can combine a published npm package with a locally-symlinked workspace package in the same `CS_PLUGINS` list.

---

## Building a plugin for an external repo

Checklist when creating a plugin in its own repository:

- [ ] `"type": "module"` in `package.json`
- [ ] `exports["."].import` points to `./dist/index.js`, `exports["."].types` to `./dist/index.d.ts`
- [ ] Declare `@cognitive-substrate/core-types`, `@cognitive-substrate/plugin-loader` as **peerDependencies** (and devDependencies), not regular dependencies
- [ ] Declare `@cognitive-substrate/kafka-bus` and `hono` as peer deps only if the plugin uses `createWebhookRouter`
- [ ] `src/index.ts` exports `export const plugin: CognitiveSubstratePlugin`
- [ ] `embedding: []` in all returned `ExperienceEvent` objects
- [ ] Standalone `tsconfig.json` (no `extends "../../tsconfig.base.json"` -- that path won't exist outside the monorepo)
- [ ] `.gitignore` includes `node_modules/`, `dist/`, `*.tsbuildinfo`
- [ ] Build produces `dist/index.js` and `dist/index.d.ts` before the package is consumed

---

## Constraints

**Event type ownership is exclusive.** Two plugins cannot claim the same `event.type`. The registry throws on the second registration. Built-in types (`page_view`, `article_complete`, `scroll_depth`, etc.) are always registered first and cannot be overridden.

**No hot-reload.** Node's ESM module cache means a second `import()` of the same specifier returns the cached module. Rebuild and restart the process to update a plugin.

**Always use bare specifiers.** `CS_PLUGINS` takes package names, not file paths. File paths break when the package is installed via npm rather than a local symlink.

**Build before activating.** The runtime imports `dist/index.js`. The TypeScript source is never executed directly (unless running with `tsx` in development).

**Fail loudly from `create()`, silently from `map()`.** If a plugin is misconfigured, `create()` should throw so the process exits before serving traffic. If an individual event cannot be mapped, return `null` rather than throwing -- the message is dropped cleanly and processing continues.

---

## First-party plugins

| Plugin | Repo | Handles | Webhook path |
| --- | --- | --- | --- |
| `@cognitive-substrate/plugin-slack` | [SBPnet/cognitive-substrate-plugin-slack](https://github.com/SBPnet/cognitive-substrate-plugin-slack) | `slack_thread` | `POST /api/webhooks/slack_thread` |
| `@cognitive-substrate/plugin-zendesk` | [SBPnet/cognitive-substrate-plugin-zendesk](https://github.com/SBPnet/cognitive-substrate-plugin-zendesk) | `zendesk_ticket` | `POST /api/webhooks/zendesk_ticket` |
| `@cognitive-substrate/plugin-jira` | [SBPnet/cognitive-substrate-plugin-jira](https://github.com/SBPnet/cognitive-substrate-plugin-jira) | `jira_issue` | `POST /api/webhooks/jira_issue` |

Required env vars per plugin:

| Plugin | Service | Env var | Description |
| --- | --- | --- | --- |
| plugin-slack | API | `SLACK_SIGNING_SECRET` | Signing secret from Slack app Basic Information page |
| plugin-zendesk | API | `ZENDESK_WEBHOOK_SECRET` | Signing secret from Zendesk webhook detail page |
| plugin-jira | API | `JIRA_WEBHOOK_SECRET` | Token appended as `?token=` on the Jira webhook URL |
