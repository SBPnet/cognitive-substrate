# Stage 35: OpenSearch ML Inference Nodes

## Claim

OpenSearch ML inference can move embedding and reranking closer to memory storage. The repository implements a client wrapper and retrieval integration surfaces for model registration, deployment, ingest pipeline setup, and optional reranking.

## Runtime Surface

The primary code path is `packages/memory-opensearch/src/ml-inference.ts`. Retrieval integration lives in `packages/retrieval-engine/`, and topology context lives in `docs/architecture/opensearch-ml-nodes.md`, `docs/architecture/opensearch-topology.md`, and `infra/aiven/opensearch.tf`.

The memory schema supports multiple vector lanes in `packages/memory-opensearch/src/schemas.ts` and environment-derived profiles in `packages/memory-opensearch/src/profiles.ts`.

## Evidence

The inventory marks Stage 35 as implemented with focused tests. Model swap behavior is covered by `packages/memory-opensearch/src/__tests__/model-swap.test.ts`, and retrieval mode behavior is covered by `packages/retrieval-engine/src/__tests__/retrieval-mode.test.ts`.

## Limitations

This article does not claim deployed ML-node availability in every environment. Latency, cost, recall, and reranking quality require a running OpenSearch cluster with ML Commons enabled, registered models, and benchmark queries.
