---
title: Identity Formation Architecture
category: architecture
status: draft
---

# Identity Formation Architecture

## Implementation Status

Identity formation is represented by narrative and identity state packages, especially `packages/narrative-engine/` and the `identity_state` OpenSearch schema in `packages/memory-opensearch/src/schemas.ts`. The current repository supports identity records and narrative synthesis surfaces, but does not prove personhood, selfhood, or subjective continuity.

## Purpose

Identity formation tracks longitudinal behavioral tendencies, narrative coherence, and policy continuity. In this project, identity is an engineering artifact: a versioned, inspectable record of stable patterns, not a claim about consciousness.

## Runtime Surface

Relevant code lives in `packages/narrative-engine/src/selfhood.ts`, `packages/narrative-engine/src/synthesis.ts`, `packages/narrative-engine/src/scoring.ts`, and `packages/memory-opensearch/src/schemas.ts`.

## Flow

Policy updates, reinforcement outcomes, memory consolidation, and agent activity can supply evidence for identity records. Narrative synthesis can summarize continuity and tension across those records.

## Evidence

The stage is currently entrypoint-level in the inventory. Treat identity claims as structural and documentary until behavioral evaluation covers longitudinal runs.
