---
title: Social Engine Architecture
category: architecture
status: draft
---

# Social Engine Architecture

## Implementation Status

The implemented source surface is `packages/social-engine/`. `docs/architecture/inventory.md` currently treats this stage conservatively; most Series II engines have package entrypoints and focused or entrypoint evidence, not longitudinal behavioral proof.

## Purpose

This component tracks social and multi-agent alignment signals. The architecture treats the name as a functional engineering label, not a biological or psychological equivalence claim.

## Runtime Surface

Review `packages/social-engine/src/index.ts` and neighboring files for the current exported API. Runtime wiring varies by stage; do not assume a Kafka topic, worker, or OpenSearch index exists unless it is declared in `packages/kafka-bus/src/topics.ts`, `packages/memory-opensearch/src/schemas.ts`, or an app under `apps/`.

## Integration Points

The engine is intended to interact with memory, policy, agent runtime, and observability surfaces through typed package APIs. Where Kafka is involved, the source-of-truth topic registry is `packages/kafka-bus/src/topics.ts`.

## Evidence

Current evidence is the TypeScript package surface and any tests or smoke coverage recorded in `docs/architecture/inventory.md`. Stronger claims about emergent behavior, transfer, stability, or intelligence require dedicated runtime evaluation.
