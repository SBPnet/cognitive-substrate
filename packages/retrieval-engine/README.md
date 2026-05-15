# @cognitive-substrate/retrieval-engine

Hybrid memory retrieval pipeline. Resolves embeddings, executes BM25 + k-NN queries against OpenSearch, and optionally reranks results with a cross-encoder.

## What it does

The retrieval engine is the read path for semantic memories during the cognitive loop's retrieve stage. It runs a three-stage pipeline:

1. **Embedding resolution** — if a query embedding is not provided, calls a pluggable `Embedder` to produce one.
2. **Hybrid query** — delegates to `memory-opensearch`'s `buildHybridQuery()` with weights drawn from the active policy. Over-fetches by a configurable factor when reranking is enabled.
3. **Reranking (optional)** — passes the over-fetched candidate set through a pluggable `Reranker` (default: cross-encoder via OpenSearch ML), then slices to the requested top-k.

After retrieval, it records a `RetrievalFeedback` event to Kafka for downstream reinforcement scoring.

## API

```ts
import { MemoryRetriever, RetrievalRequest, RetrievalResult } from '@cognitive-substrate/retrieval-engine';

const retriever = new MemoryRetriever({ store, embedder, reranker, policy });
const result: RetrievalResult = await retriever.retrieve({
  query: 'attention under load',
  topK: 10,
});
// result.memories[] — ranked SemanticMemory records
// result.scores[] — final relevance scores
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `MemoryRetriever` | Main retriever; inject `store`, optional `embedder` and `reranker` |
| `RetrievalRequest` | Query text, optional embedding, topK, policy override |
| `RetrievalResult` | Ranked memories with scores |

## Dependencies

- `@cognitive-substrate/core-types` — `Memory`, `Policy` types
- `@cognitive-substrate/kafka-bus` — publishes retrieval feedback events
- `@cognitive-substrate/memory-opensearch` — executes hybrid queries
