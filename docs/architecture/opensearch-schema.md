---
title: OpenSearch Schema Architecture
category: architecture
status: draft
---

# OpenSearch Schema Architecture

## Implementation Status

The source-of-truth OpenSearch schema registry is `packages/memory-opensearch/src/schemas.ts`. Index names or fields mentioned in older design docs are proposals unless they appear there or in a runtime migration path.

## Purpose

OpenSearch stores the memory and cognitive state that must be searchable by text, vector similarity, filters, and lifecycle metadata. It is the primary read surface for retrieval and a durable side channel for agent, policy, goal, world-model, identity, and audit records.

## Runtime Indexes

The schema registry currently covers:

- `experience_events` for episodic event memory.
- `memory_semantic` for consolidated semantic memory.
- `policy_state` for policy snapshots.
- `agent_activity` for agent traces.
- `world_model_predictions` for simulated outcomes.
- `goal_system` for goals and progress state.
- `identity_state` for identity records.
- `self_modifications` for self-modification proposals and decisions.
- `memory_links` for memory graph relations.
- `retrieval_feedback` for retrieval usefulness evidence.
- `operational_patterns` for detected operational patterns.
- `audit_events` for durable audit records.
- `model_registry` for embedding and model metadata.

## Embedding Fields

`packages/memory-opensearch/src/schemas.ts` defines multiple vector dimensions through environment-driven settings. Retrieval code supports quality, efficient, hybrid, and legacy vector lanes through `packages/memory-opensearch/src/query-builder.ts` and `packages/retrieval-engine/src/retriever.ts`.

## Querying

Retrieval combines lexical search, vector search, recency, importance, decay, retrieval feedback, and policy alignment where those fields are present. Consolidation uses replay selection queries rather than reading all memory indiscriminately.

## Evidence

Schema evidence is the `INDEX_SCHEMAS` export in `packages/memory-opensearch/src/schemas.ts`, index creation in `packages/memory-opensearch/src/client.ts`, and focused tests under `packages/memory-opensearch/src/__tests__/` and `packages/retrieval-engine/src/__tests__/`.
