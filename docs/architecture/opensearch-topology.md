---
title: OpenSearch Topology Architecture
category: architecture
status: draft
---

# OpenSearch Topology Architecture

## Implementation Status

This document describes intended memory placement and the implemented package surfaces. Hosted topology details must be verified against `infra/aiven/opensearch.tf` and the active cluster configuration before publication as deployment fact.

## Purpose

OpenSearch provides low-latency cognitive memory access. The topology separates durable event storage, semantic memory, vector retrieval, model-assisted embedding or reranking, operational pattern search, and audit records.

## Node Roles

The repository supports a topology with data/query nodes for memory indexes and optional ML node pools for local embedding and reranking. `docs/architecture/opensearch-ml-nodes.md` covers the ML tier in more detail.

## Index Placement

High-write indexes such as `experience_events` and `audit_events` should be isolated from slower semantic or analytical workloads where the managed service allows it. Semantic indexes such as `memory_semantic` and `operational_patterns` are retrieval-heavy and should be tuned for query stability. Runtime schema remains in `packages/memory-opensearch/src/schemas.ts`.

## Retrieval Path

The retrieval engine reads from `experience_events` and `memory_semantic`, maps search hits into memory references, optionally reranks candidates, and writes retrieval evidence. The topology should therefore protect both indexing throughput and query latency.

## Evidence

Implemented evidence includes `packages/memory-opensearch/`, `packages/retrieval-engine/`, `docs/architecture/opensearch-ml-nodes.md`, and smoke scripts that exercise OpenSearch setup or model swap behavior.
