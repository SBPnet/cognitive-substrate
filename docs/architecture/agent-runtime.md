---
title: Agent Runtime Architecture
category: architecture
status: draft
---

# Agent Runtime Architecture

## Implementation Status

The implemented agent runtime is in `packages/agents/` and is used by `apps/orchestrator/`. It contains deterministic agent types, arbitration, session handling, activity storage, goal support, and a reasoning-model interface. More speculative swarm topics in draft documents are proposals unless present in `packages/kafka-bus/src/topics.ts`.

## Purpose

The agent runtime turns a user session event plus retrieved memory and policy context into candidate responses. It decomposes reasoning across specialized agents, arbitrates their proposals, records activity, and emits a selected result back to the interaction path.

## Runtime Surface

Key files are `packages/agents/src/loop.ts`, `packages/agents/src/multi-agent-runtime.ts`, `packages/agents/src/specialized-agents.ts`, `packages/agents/src/arbitration.ts`, `packages/agents/src/session.ts`, and `packages/agents/src/activity-store.ts`.

## Flow

The cognitive loop gathers session state, goals, policy state, and memory references. The multi-agent runtime asks planner, executor, critic, memory, world-model, and metacognition agents for proposals. Arbitration scores candidates by confidence, usefulness, and risk before selecting a response.

## Runtime Wiring

The orchestrator owns Kafka and response routing. Agent runtime code stays package-local and depends on ports for memory retrieval, policy evaluation publishing, session state, goals, and tool execution.

## Evidence

Series I inventory marks the cognitive agent loop, multi-agent decomposition, internal debate, and multi-agent society stages as implemented with behavioral evidence. Confirm current runtime behavior with smoke reports and orchestrator tests before making stronger claims.
