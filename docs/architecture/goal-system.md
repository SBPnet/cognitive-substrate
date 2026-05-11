---
title: Goal System Architecture
category: architecture
status: draft
---

# Goal System Architecture

## Implementation Status

Goal support is implemented in `packages/agents/src/goal-system.ts` with Kafka publishing support in `packages/agents/src/goal-publisher.ts`. Goal storage schemas are declared in `packages/memory-opensearch/src/schemas.ts`.

## Purpose

The goal system tracks long-horizon objectives, selects relevant goals for a session, scores event relevance, and emits progress updates. It provides continuity across individual interactions without requiring every event to carry the full plan.

## Runtime Surface

Primary files are `packages/agents/src/goal-system.ts`, `packages/agents/src/goal-publisher.ts`, and the `goal_system` schema in `packages/memory-opensearch/src/schemas.ts`.

## Flow

Goals are created, scored against context, updated with progress, and optionally emitted on `goal.progress`. The orchestrator and agent runtime can use the active goal set as context for reasoning.

## Evidence

The inventory marks long-horizon goals as implemented with behavioral evidence. Publication claims should stay close to selection, relevance scoring, and progress tracking unless longer-run evaluation is available.
