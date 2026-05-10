---
title: Local Inference for Operational Memory
chapter: 29
arc: operational-intelligence
status: draft
tags: [opensearch, ml-commons, embeddings, reranking, memory]
---

# Chapter 29. Local Inference for Operational Memory

*Chapter 29. Companion code: Stage 35 (OpenSearch ML inference nodes). See also `docs/articles/article-04-opensearch-ml-inference.md` for the engineering narrative.*

## Conceptual placement

This chapter is an infrastructure interlude. Conceptually, local embedding and reranking belong beside the memory substrate in Chapter 02 because they change how memories are indexed, recalled, and ordered. The chapter appears in the operational intelligence arc because the implementation was delivered with the later telemetry and infrastructure work.

The placement does not change the conceptual dependency: local inference is a memory optimization, not a new form of operational cognition.

## 29.1 Inference Placement

Memory retrieval depends on embedding generation and relevance scoring. When these operations are external to the memory store, indexing and retrieval acquire additional network latency, operational cost, and failure modes.

Stage 35 places lightweight inference inside the OpenSearch cluster through ML Commons and dedicated ML node pools. This design moves embedding and reranking close to the indexes that use them while keeping long-context reasoning outside the search cluster.

## 29.2 Tiered Inference

The architecture defines two local inference tiers.

Tier 1 provides embedding inference. It uses small sentence-transformer models and targets low-latency vector generation for indexing and query embedding.

Tier 2 provides reranking. It uses cross-encoder or text-similarity models to rescore a candidate set returned by initial vector recall.

The tiers differ in cost and purpose. Embedding optimizes recall. Reranking optimizes final ordering.

## 29.3 Retrieval Decomposition

Let $q$ be a query and $D$ be a document corpus. Retrieval is decomposed into two steps:

$$C_k = recall(q, D, k \cdot f)$$

$$R_n = top_n(rerank(q, C_k))$$

where $C_k$ is an over-fetched candidate set, $f$ is the over-fetch factor, and $R_n$ is the final result set after reranking.

This decomposition preserves approximate vector search efficiency while allowing a more expensive model to judge a bounded candidate set.

## 29.4 Auto-Embedding Pipeline

The Tier 1 model is attached to an OpenSearch ingest pipeline through the `text_embedding` processor. Documents written to `experience_events` or `memory_semantic` can therefore receive embeddings at index time.

The ingestion worker no longer needs to own embedding calls for these indexes. The memory store becomes responsible for maintaining its own vector fields.

## 29.5 Isolation

ML Commons is configured so inference runs only on ML nodes. This protects data nodes and query coordinators from model execution load.

Isolation is a cognitive economics decision. Embedding and reranking consume compute budget that should not interfere with primary index health. Dedicated pools make that budget explicit and scalable.

## 29.6 Boundary of Local Inference

The local inference tier is not intended for long-context language-model reasoning. Consolidation, planning, and deep synthesis remain external LLM functions. OpenSearch ML nodes are appropriate for bounded inference operations whose inputs and outputs are tightly coupled to retrieval.

## 29.7 Evaluation Plan

Empirical validation should measure embedding latency, indexing throughput, reranking latency, retrieval quality, and cluster resource interference. Until those measurements exist, latency targets and relevance improvements are design proposals.

---

*Companion article: `docs/articles/article-04-opensearch-ml-inference.md`. Architecture documentation: `docs/architecture/opensearch-ml-nodes.md`. Source code: `packages/memory-opensearch/src/ml-inference.ts`, `packages/retrieval-engine/`, and `infra/aiven/opensearch.tf`.*
