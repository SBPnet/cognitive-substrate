---
title: World Model Architecture
category: architecture
status: draft
---

# World Model Architecture

## Implementation Status

The world-model package is implemented in `packages/world-model/`. It includes a heuristic simulation model, OpenSearch-backed prediction store, Kafka publisher, and engine surface.

## Purpose

The world model simulates possible outcomes before action. It gives the agent runtime a way to represent expected consequences, risks, confidence, and prediction records.

## Runtime Surface

Key files are `packages/world-model/src/engine.ts`, `packages/world-model/src/model.ts`, `packages/world-model/src/store.ts`, and `packages/world-model/src/publisher.ts`.

## Flow

A simulation input is evaluated by an outcome model, stored as a prediction, and optionally emitted on `worldmodel.prediction`. The source-of-truth topic declaration is `packages/kafka-bus/src/topics.ts`.

## Evidence

`docs/architecture/inventory.md` marks the world-model stage as implemented with behavioral evidence. The default model is heuristic, so claims should focus on structure and traceability rather than predictive accuracy.
