# Stage 12: Long-Horizon Goals

*This article accompanies Stage 12 of the cognitive-substrate project. It describes the goal system that organizes behaviour across multiple time horizons and feeds goal relevance back into reinforcement.*

## Why goals need hierarchy

A reactive agent can complete local tasks without preserving direction. A cognitive agent needs structure across time: immediate actions, short-term objectives, mid-term projects, long-term aims, and meta-goals that regulate the goal system itself.

Stage 12 introduces this hierarchy.

## Goal levels

The goal system models micro, short, mid, long, and meta horizons. Micro goals guide the next action. Short goals guide the current session. Mid goals organize projects. Long goals preserve durable direction. Meta-goals regulate how goals are selected, revised, and balanced.

This hierarchy prevents immediate reward from dominating all behaviour.

## Decomposition

Longer goals are decomposed into shorter subgoals. Decomposition lets the agent connect a distant objective to the next executable step.

The relationship is not one-way. Progress or failure at lower levels can revise higher-level expectations. A long goal may remain stable while its plan changes.

## Priority selection

The system selects active goals based on priority, relevance, urgency, and policy alignment. Selected goals become part of the context hydrated into the agent loop.

This makes goals operational. They are not passive records; they condition retrieval, reasoning, arbitration, and reinforcement.

## Progress events

Goal progress is tracked through `goal.progress` events. These events record movement, blockers, completion, and regression.

Progress signals feed reinforcement scoring. An experience that advances an important goal becomes more valuable for future retrieval and policy learning.

## Artifacts (Tier A)

**Stage covered:** 12, Long-Horizon Goals.

**Packages shipped:** Goal system extensions in `packages/agents/`.

**Topics:** The system emits `goal.progress` events.

**Tier B:** Runtime evidence requires goal definitions, agent-loop integration, and progress-producing tasks.

**Quantitative claims:** Claims about long-horizon task success remain pending evaluation.

*Source code: `packages/agents/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/05-world-models-goals.md`.*
