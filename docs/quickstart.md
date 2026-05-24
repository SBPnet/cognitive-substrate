# Quick Start

From `git clone` to a running cognitive loop in under 10 minutes.

## Prerequisites

- Node 22+ (`node --version`)
- pnpm 10+ (`pnpm --version`)
- Docker Desktop (for OpenSearch)

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start OpenSearch

```bash
docker compose -f docker-compose.opensearch-cluster.yml up -d
```

Wait ~30 seconds, then verify it's ready:

```bash
curl -s http://localhost:9200/_cluster/health | grep -o '"status":"[^"]*"'
# Expected: "status":"yellow" or "status":"green"
```

## 3. Build all packages

```bash
pnpm build
```

## 4. Choose a reasoning model (pick one)

**Option A: Claude (Anthropic)**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Option B: xAI Grok (or any OpenAI-compatible endpoint)**

```bash
export OPENAI_BASE_URL=https://api.x.ai/v1
export OPENAI_API_KEY=xai-...
export OPENAI_MODEL=grok-4.3
```

**Option C: Google Gemini**

```bash
export GEMINI_API_KEY=AIza...
```

**Option D: Ollama (local, free)**

```bash
# Start Ollama with any chat model, then:
export OLLAMA_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3.2
```

**Option E: No API key (deterministic multi-agent, no external calls)**

No env vars needed. The system uses heuristic agents as a free fallback.

## 5. Run a full-stack experiment

```bash
OPENSEARCH_URL=http://localhost:9200 \
  pnpm --filter @cognitive-substrate/experiment-corpus exp44
```

Results land in `packages/experiment-corpus/results/experiment-44-results.md`.

## 6. Scaffold your first plugin

```bash
# Generate a fully-wired, buildable plugin package:
node packages/create-plugin/dist/cli.js my-plugin ingest-mapper

# Edit the generated template:
# packages/my-plugin/src/index.ts

# Build it:
pnpm install
pnpm --filter @cognitive-substrate/my-plugin build

# Activate it:
CS_PLUGINS=@cognitive-substrate/my-plugin \
  pnpm --filter @cognitive-substrate/orchestrator start
```

See [docs/plugins.md](plugins.md) for the full plugin API reference.

Available scaffold kinds: `ingest-mapper`, `engine`, `tool-executor`.

## 7. Connect an MCP server (optional)

```bash
export MCP_SERVERS='[{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]'
# Restart the orchestrator. It auto-connects, discovers tools, and makes them
# available to the cognitive loop. MCP tool results feed back into memory.
```

Check MCP server health:

```bash
curl http://localhost:3000/api/health/mcp
# {"servers":[{"name":"fs","healthy":true,"toolCount":7}]}
```

## 8. Control model priority

By default the orchestrator tries providers in cost-ascending order:
`ollama` > `openai-compat` > `gemini` > `claude` > `multi-agent`

Override with:

```bash
# Force Claude only, skip Ollama/Grok even if configured:
CS_ENGINE_ORDER=claude,multi-agent

# Dev mode (no external API calls):
CS_ENGINE_ORDER=multi-agent
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `OPENSEARCH_URL not set` | `export OPENSEARCH_URL=http://localhost:9200` |
| Silent retrieval failures | Check that `memoryIndex` matches `SOURCE_INDEX` in experiment config |
| Plugin fails to load | Build first: `pnpm --filter <pkg> build` -- loader imports `dist/index.js` |
| MCP server not connecting | Validate JSON: `node -e "JSON.parse(process.env.MCP_SERVERS)"` |
| Wrong model used | Check `CS_ENGINE_ORDER` and that the required API key env var is set |
