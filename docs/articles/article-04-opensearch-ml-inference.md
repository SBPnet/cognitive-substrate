# Stage 35: OpenSearch ML Inference Nodes

*This article accompanies Stage 35 of the cognitive-substrate project. It describes the OpenSearch ML node tiers used for local embedding and reranking within the memory retrieval path.*

## Why inference belongs near memory

The memory substrate depends on vector embeddings and candidate reranking. Earlier stages can call an external embedding service, but that design couples memory throughput to a remote API and makes indexing cost scale with provider calls.

OpenSearch ML Commons provides a local inference surface inside the search cluster. Stage 35 adds dedicated ML node pools and a TypeScript client wrapper so embeddings and reranking can run near the indexes that consume them.

## A memory-infrastructure interlude

This stage appears late in the implementation roadmap because it was delivered alongside later infrastructure work. Conceptually, however, it belongs beside the memory substrate introduced in Stages 1 and 2.

The public reading order treats Stage 35 as an interlude after retrieval. It does not change what memory is; it changes where the low-level inference that supports memory retrieval runs.

## Two inference tiers

The architecture uses two OpenSearch ML tiers.

Tier 1 is the embedding pool. It hosts small text embedding models such as `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, or `e5-small-v2`. These models produce 384-dimensional vectors and target low-latency inference for index-time and query-time embedding.

Tier 2 is the reranker pool. It hosts cross-encoder or text similarity models such as `bge-reranker-base` or `cross-encoder/ms-marco-MiniLM-L-6-v2`. Reranking is slower than embedding but more precise because it scores query and document text jointly.

Dedicated node pools isolate inference from data and query nodes. This prevents model execution from consuming CPU needed for indexing, shard movement, or search coordination.

## Auto-embedding ingest pipeline

The `OpenSearchMlClient` in `packages/memory-opensearch/src/ml-inference.ts` wraps model registration, deployment, task polling, ingest pipeline creation, and reranking calls.

For Tier 1, `ensureEmbeddingIngestPipeline()` creates a `text_embedding` ingest pipeline. The pipeline reads a source text field, usually `summary`, and writes an `embedding` field. When attached to `experience_events` and `memory_semantic`, embeddings are generated automatically at index time.

This simplifies ingestion workers. They can write semantic documents without managing a separate embedding API path for those indexes.

## Reranking in retrieval

The retrieval engine can optionally accept a reranker. When configured, initial vector recall over-fetches candidates, sends them to the Tier 2 model, sorts by reranker score, and returns the best final results.

This preserves the speed of approximate recall while improving final relevance. The architecture therefore separates recall from judgment: vector search finds plausible memories, and reranking decides which memories deserve scarce reasoning context.

## Operational constraints

ML nodes are not general-purpose LLM hosts. The stage is designed for embeddings, reranking, lightweight classifiers, and sparse encoders. Long-context reasoning remains outside OpenSearch because latency and memory requirements are substantially larger.

The model lifecycle also remains explicit. Models must be registered, deployed, and supplied to workers through stable model identifiers. This avoids hidden coupling between infrastructure provisioning and runtime behaviour.

## Artifacts (Tier A)

**Stage covered:** 35, OpenSearch ML Inference Nodes.

**Packages shipped:** `packages/memory-opensearch/src/ml-inference.ts` provides the ML Commons client wrapper. `packages/retrieval-engine/` supports optional reranking in retrieval.

**Infrastructure:** `infra/aiven/opensearch.tf` provisions embedding and reranker ML node pools and enables ML Commons settings.

**Tier B:** Runtime evidence requires a deployed OpenSearch cluster with ML Commons enabled and registered models.

**Quantitative claims:** Latency targets and relevance improvements remain design targets pending benchmark evidence.

*Source code: `packages/memory-opensearch/src/ml-inference.ts`, `packages/retrieval-engine/`, and `infra/aiven/opensearch.tf`. Architecture documentation: `docs/architecture/opensearch-ml-nodes.md`. Companion paper chapter: `docs/paper/29-local-inference-memory.md`.*
