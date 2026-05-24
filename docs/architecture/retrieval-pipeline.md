# Retrieval Pipeline

Every cognitive turn performs a hybrid retrieval pass that combines BM25 full-text matching with k-NN approximate nearest-neighbour search. This document describes the full path from query to ranked `MemoryReference[]`.

## Entry points

- **Cognitive loop** (`packages/agents/src/loop.ts`): calls `MemoryRetrieverPort.retrieve` with `queryText`, optional `queryEmbedding`, `size: 8`, and the current `PolicyState`.
- **Experiments**: call `MemoryRetriever.retrieve` directly with arbitrary options.

The production implementation is `MemoryRetriever` in `packages/retrieval-engine/src/retriever.ts`.

## Step 1 -- embedding resolution

If the request includes a `queryEmbedding`, it is used directly (avoiding a round-trip to the ML node). Otherwise the configured `QueryEmbeddingClient` embeds `queryText` on the fly.

The default production embedder (`queryEmbedderFromEnv` in `apps/orchestrator/src/embedder.ts`) targets an OpenAI-compatible `/v1/embeddings` endpoint, so operators can swap between cloud and local model lanes by changing environment variables only.

If no embedder is configured and no embedding is provided, `retrieve` throws. This is intentional: silent zero-vector queries produce misleading results (high-score matches are arbitrary).

## Step 2 -- index fan-out

`MemoryRetriever` queries two indexes in parallel by default:

| Index | BM25 fields | Timestamp field | Tag filter |
|-------|-------------|-----------------|------------|
| `experience_events` | `summary` | `timestamp` | yes |
| `memory_semantic` | `summary`, `generalization` | `created_at` | no |

Each index gets its own `buildHybridQuery` call. When a reranker is configured, `perIndexSize` is multiplied by `rerankOverfetchFactor` (default 3) so the cross-encoder has a larger candidate pool.

## Step 3 -- hybrid query construction

`buildHybridQuery` (`packages/memory-opensearch/src/query-builder.ts`) builds an OpenSearch `hybrid` query containing two sub-queries:

**Lexical sub-query (BM25)**:
```json
{
  "multi_match": {
    "query": "<queryText>",
    "fields": ["summary", "generalization"],
    "type": "best_fields",
    "tie_breaker": 0.3,
    "boost": <lexicalWeight>
  }
}
```

**Vector sub-query (k-NN)**:
```json
{
  "knn": {
    "<vectorField>": {
      "vector": [...],
      "k": <size>,
      "boost": <vectorWeight>
    }
  }
}
```

Both sub-queries carry the same filter clauses (importance floor, timestamp window, required tags) so filters are respected by both the lexical and vector passes.

### Policy weighting

The relative weights of the two sub-queries are driven by `PolicyState`:

```
vectorWeight = max(0.1, retrievalBias × memoryTrust × 2)
lexicalWeight = 1   (fixed)
```

A policy with `retrievalBias=0.8` and `memoryTrust=0.9` produces `vectorWeight=1.44`, tilting the hybrid toward semantic similarity. A conservative policy (`retrievalBias=0.3`, `memoryTrust=0.4`) keeps vectorWeight near 0.24, favouring keyword recall.

Operators can also override both weights explicitly via `RetrievalFusionOptions` (Exp 42 alpha-sweep).

### Retrieval mode (vector field selection)

| Mode | Vector field | Model | Dims |
|------|-------------|-------|------|
| `quality` | `embedding_qwen` | Qwen3 family | varies |
| `efficient` | `embedding_nomic` | nomic-embed-text | 768 |
| `hybrid` | `embedding_bge_m3` | BGE-M3 dense | 768 |
| `legacy` | `embedding` | all-MiniLM-L6-v2 (Exp 24 default) | 384 |

The cognitive loop uses `"efficient"` by default. Pass `knnField` to override for experimental indexes.

### Filters

All filters are applied inside each sub-query so they affect both the lexical and vector passes:

- `importanceScore >= minImportance` (default 0.0 -- no filter)
- `timestamp >= sinceTimestamp` (optional)
- `tags: requiredTags` (optional; only applied when `includeTagFilter: true`)

Embedding vectors are excluded from `_source` responses to reduce network transfer.

## Step 4 -- candidate merge

Results from both indexes are flattened into a single candidate list via `mapSearchHitToMemoryReference` (`packages/retrieval-engine/src/mapper.ts`). The mapper maps raw OpenSearch hit fields to `MemoryReference` fields (`score`, `summary`, `importanceScore`, etc.).

## Step 5 -- reranking (optional)

When a `RerankClient` is configured, the merged candidate set is passed to a Tier-2 cross-encoder:

1. Extract `summary` text from each candidate.
2. Call `RerankClient.rerank(queryText, summaries)` -- typically the `ms-marco-MiniLM-L-6-v2` model via `OpenSearchMlClient`.
3. Replace each candidate's `score` with the cross-encoder score (candidates not scored by the reranker retain their original score).
4. Sort descending and slice to `finalSize`.

Without reranking, candidates are sorted by their raw BM25 + k-NN score and sliced directly.

Exp 36 showed that for well-separated corpora the bare k-NN is already P@1=1.0 -- reranking adds value when window vocabularies overlap (the `ms-marco` model sees the actual query-document pair and can discriminate where k-NN scores converge).

## Step 6 -- diversity slot (optional, experiment-level)

The diversity slot is not built into `MemoryRetriever` itself. Experiment-level code (`packages/retrieval-engine/src/breadth.ts`) injects it by reserving one slot in the top-k for a random low-scoring candidate from the bottom quartile.

Effect (Exp 35): unique memory coverage across 500 retrievals expanded from 20 to 52 IDs (2.6x). The injected IDs are drawn from all windows, not biased to any single cluster.

If strict precision is more important than exploration breadth, disable the diversity slot.

## RetrievalFeedbackWriter -- closing the reinforcement loop

After a turn completes, the caller can record whether each retrieved memory was used:

```typescript
const writer = new RetrievalFeedbackWriter({ openSearch, auditPublisher });
await writer.record({
  querySummary,
  retrievedMemoryId,
  usedInResponse: true,
  helpfulnessScore: 0.9,
  hallucinationDetected: false,
  futureWeightAdjustment: (helpfulnessScore - 0.5) * 0.2
});
```

The record is written to the `retrieval_feedback` index and optionally mirrored to the audit Kafka topic. The `futureWeightAdjustment` sign rules:
- `helpfulnessScore >= 0.8` -> mean FWA +0.093 (Exp 39)
- `hallucinationDetected: true` -> FWA always negative, regardless of helpfulness score

The `ReinforcementEngine` uses `futureWeightAdjustment` as part of the decay scoring signal, creating a feedback loop: helpful retrievals accumulate positive `retrieval_priority`; hallucinated ones are down-weighted even if they appeared relevant at query time.

## Common failure modes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| All retrievals return 0 results (no error) | `memoryIndex` in loop config doesn't match `SOURCE_INDEX` used when seeding | Align both to the same index name |
| `queryEmbedding is required` error | No embedder configured and no pre-computed embedding | Set `EMBEDDER_URL` env var or pass `queryEmbedding` in the request |
| `ConjunctionDISI` error in OpenSearch 3.0 | Mixed-doc shard: some docs missing the `knn_vector` field | Use the HNSW / lucene engine (not faiss); ensure all docs in a shard have the vector field |
| Cross-encoder reranker not improving results | `hasReranker: false` (model not deployed) | Deploy the reranker model to the OpenSearch ML node first |
| Diversity slot surfacing low-quality memories | No importance floor on diversity candidates | Set `minImportance` in the request options |
