---
title: Policy Engine Architecture
category: architecture
status: draft
---

# Policy Engine Architecture

## Implementation Status

The policy engine is implemented in `packages/policy-engine/`. It supports in-memory and OpenSearch-backed policy stores, default policy state, reward delta computation, clamped updates, and policy update events.

## Purpose

Policy state is the bounded behavioral memory of the substrate. It records which tendencies may drift after evaluated outcomes while preventing a single event from rewriting behavior without limits.

## Runtime Surface

Key files are `packages/policy-engine/src/engine.ts`, `packages/policy-engine/src/drift.ts`, `packages/policy-engine/src/store.ts`, and `packages/policy-engine/src/defaults.ts`.

## Flow

A policy evaluation input becomes a policy delta. The delta is clamped, applied to the current policy vector, persisted as a new snapshot, and emitted as a policy update event for downstream consumers.

## Evidence

`docs/architecture/inventory.md` marks the policy engine stage as implemented with behavioral evidence. Publication claims should remain limited to bounded update mechanics unless accompanied by convergence or behavior-improvement evaluation.
