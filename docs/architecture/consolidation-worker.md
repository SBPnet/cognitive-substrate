---
title: Consolidation Worker Architecture
category: architecture
status: draft
---

# Consolidation Worker Architecture

## Implementation Status

The worker exists in `apps/workers/consolidation/` and the reusable engine exists in `packages/consolidation-engine/`. The implemented path is extractive and schema-driven; claims about deep abstraction quality require additional evaluation.

## Purpose

Consolidation replays selected experiences after ingestion, compresses related evidence into semantic memory, surfaces contradictions, and emits semantic memory updates for downstream retrieval.

## Runtime Surface

The worker consumes consolidation work from Kafka, calls `packages/consolidation-engine/`, reads replay candidates from OpenSearch, writes semantic memory records, and emits `memory.semantic.updated` through the topic registry in `packages/kafka-bus/src/topics.ts`.

## Selection And Compression

Replay selection uses importance, recency, novelty, reward, and related metadata where available. The default model in `packages/consolidation-engine/src/model.ts` is extractive rather than a hosted long-context reasoner.

## Evidence

The implementation is covered by worker source, engine source, and behavioral smoke evidence recorded in `docs/architecture/inventory.md`. Quantitative claims about abstraction stability remain future evaluation work.
