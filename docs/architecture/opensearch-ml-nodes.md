# OpenSearch ML Node Tiers

## Overview

OpenSearch ML Commons allows pre-trained models to be deployed to dedicated ML nodes within the cluster. This removes the need for an external embedding API call on every index or search operation, reduces network latency, and keeps inference costs proportional to search volume rather than external API pricing.

The architecture uses two ML node tiers with distinct roles. A third tier (large language model reasoning) is handled externally and is not covered here.

This document describes the Stage 35 reference architecture for moving embedding and reranking closer to OpenSearch. It should be read as the local ML Commons path. The broader model-selection brief in `docs/strategy/opensearch-oss-embedding-brief.md` explores a later evaluation path with quality-first and efficiency-first model lanes, including remote inference during benchmarking. The migration path is therefore: external or application-side embeddings for early experiments, remote inference for model comparison, then local ML Commons deployment when a selected model has compatible artifacts and measured latency.

## Tier 1: Embedding Pool (fast associative recall)

**Purpose:** Generate dense vector embeddings from text fields at index time and query time.

**Models:** `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, or `e5-small-v2`. All produce 384-dimensional vectors. These models are small enough to run on CPU nodes within the latency target.

These models are the compact local baseline. Larger open-weight embedding families may outperform them, but should first be evaluated through the strategy brief's benchmark path before becoming default OpenSearch ML deployments.

**Latency target:** less than 30 ms per inference call.

**Node configuration:**
- Role: `ml`
- Node type: CPU-optimised (e.g. `m5.2xlarge`)
- Count: 2 nodes minimum, autoscale aggressively (embedding is stateless)

**Ingest pipeline:** a `text_embedding` ingest pipeline is attached to the `experience_events` and `memory_semantic` indexes. When a document is indexed, the pipeline invokes the Tier 1 model on the `summary` field and writes the result to the `embedding` field automatically. The ingestion worker no longer needs to call an external embedding service for these indexes.

**API reference:**

```
POST /_plugins/_ml/models/_register
POST /_plugins/_ml/models/{model_id}/_deploy
PUT  /_ingest/pipeline/cognitive-embedding-pipeline
```

The `OpenSearchMlClient` class in `packages/memory-opensearch/src/ml-inference.ts` wraps these calls.

## Tier 2: Reranker Pool (episodic salience scoring)

**Purpose:** Re-score the top-K candidates from the initial k-NN vector recall using a cross-encoder model. Cross-encoders score (query, document) pairs jointly rather than independently, producing significantly more accurate relevance scores at the cost of higher latency.

**Models:** `bge-reranker-base` or `cross-encoder/ms-marco-MiniLM-L-6-v2`.

**Latency target:** 50 to 150 ms for a batch of 30 candidates.

**Node configuration:**
- Role: `ml`
- Node type: larger CPU or optional GPU (e.g. `m5.4xlarge` or GPU-enabled instance)
- Count: 2 nodes minimum

**Integration with retrieval-engine:** the `MemoryRetriever` class in `packages/retrieval-engine/src/retriever.ts` accepts an optional `reranker` parameter. When a `RerankClient` is supplied:

1. The initial k-NN recall is over-fetched by `rerankOverfetchFactor` (default 3).
2. The candidates are sent to the Tier 2 model for cross-encoder scoring.
3. Results are sorted by reranker score and sliced to the requested size.

```typescript
const retriever = new MemoryRetriever({
  openSearch,
  embedder,
  reranker: {
    rerank: (query, candidates) =>
      mlClient.rerank(rerankerModelId, query, candidates),
  },
  rerankOverfetchFactor: 3,
});
```

## Terraform Configuration

The ML node pools are provisioned in `infra/aiven/opensearch.tf`:

```hcl
resource "aiven_opensearch_node_pool" "ml_embedding" {
  roles     = ["ml"]
  node_type = var.opensearch_ml_embedding_node_type
  node_count = var.opensearch_ml_embedding_node_count
}

resource "aiven_opensearch_node_pool" "ml_reranker" {
  roles     = ["ml"]
  node_type = var.opensearch_ml_reranker_node_type
  node_count = var.opensearch_ml_reranker_node_count
}
```

Default node counts are 2 for both pools. The embedding pool should be scaled based on ingestion throughput; the reranker pool based on query volume.

## OpenSearch Configuration

The following ML Commons settings are enabled in the `opensearch_user_config`:

```hcl
plugins_ml_commons_only_run_on_ml_node             = true
plugins_ml_commons_allow_registering_model_via_url = true
plugins_ml_commons_allow_custom_deployment_plan    = true
plugins_ml_commons_model_access_control_enabled    = true
```

`only_run_on_ml_node = true` ensures that model inference is isolated to the ML pools and does not consume CPU on data or query nodes.

## Model Deployment Procedure

1. Register the model via `OpenSearchMlClient.registerModel()` and wait for the task to complete.
2. Deploy the model via `OpenSearchMlClient.deployModel()`.
3. For Tier 1: call `ensureEmbeddingIngestPipeline()` to attach the pipeline to target indexes.
4. Update the environment variable or configuration that supplies `embeddingModelId` / `rerankerModelId` to the worker processes.

Model IDs are stable after deployment. Store them in the Terraform outputs or a configuration secret and pass them as environment variables to the ingestion worker and orchestrator.

## Tier 3: External LLM Reasoning

Deep reasoning, memory consolidation, and long-context synthesis are handled by an external LLM runtime (vLLM, Ollama, or a hosted API). This tier is not deployed on OpenSearch ML nodes because:

- large conversational models require significantly more memory than fits on the ML node pool
- long-context inference latency (seconds) is incompatible with the real-time retrieval path
- the orchestrator already manages external LLM integration

OpenSearch ML nodes are optimal for embeddings, reranking, lightweight classifiers, and sparse encoders. They are not intended as general-purpose LLM hosts.
