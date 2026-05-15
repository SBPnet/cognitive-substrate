# @cognitive-substrate/memory-opensearch

OpenSearch index schemas, hybrid retrieval (BM25 + k-NN), query builder, ML inference integration, and retrieval profiles for the semantic memory layer.

## What it does

This package is the semantic memory persistence and retrieval layer. It defines:

- **Index schemas** (`src/schemas.ts`) — the single source of truth for all OpenSearch index mappings. Used at migration time and referenced by every package that reads or writes memories.
- **Hybrid query builder** — combines BM25 keyword search with k-NN vector search, weighted by the active policy's `keywordWeight` / `vectorWeight` parameters.
- **ML inference client** — calls OpenSearch ML node endpoints for embedding generation and cross-encoder reranking.
- **Retrieval profiles** — four named profiles (precise, broad, recent, diverse) that pre-configure query parameters for common retrieval patterns.

## API

```ts
import { search, buildHybridQuery, PROFILES } from '@cognitive-substrate/memory-opensearch';

const query = buildHybridQuery({ text: 'attention under load', embedding, policy });
const results = await search(client, query, PROFILES.precise);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `search(client, query, profile)` | Executes a hybrid query; returns ranked `Memory[]` |
| `buildHybridQuery(params)` | Constructs a hybrid BM25 + k-NN query object |
| `PROFILES` | Named retrieval profile presets |
| `SCHEMAS` | Index mapping definitions (used by migration scripts) |
| `MLClient` | Wraps OpenSearch ML endpoints for embeddings and reranking |

## Dependencies

- `@cognitive-substrate/core-types` — `Memory`, `Policy` types
- `@opensearch-project/opensearch` — OpenSearch JS client

## Index claims

All index names are defined in `src/schemas.ts`. Other packages must import from there rather than hardcoding index names.

## Configuration

| Env var | Description |
| ------- | ----------- |
| `OPENSEARCH_URL` | OpenSearch cluster endpoint |
| `OPENSEARCH_USER` | Basic auth username |
| `OPENSEARCH_PASSWORD` | Basic auth password |
