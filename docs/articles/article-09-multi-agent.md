# Stage 6: Multi-Agent Decomposition

*This article accompanies Stage 6 of the cognitive-substrate project. It describes the decomposition of cognition into planner, executor, critic, memory, and world-model agents.*

## Why one agent is not enough

A single reasoning call forces planning, execution, critique, memory selection, and prediction into one undifferentiated process. That design is simple, but it makes failures hard to locate. Poor performance may come from bad planning, weak evidence, missing critique, or inaccurate prediction.

Stage 6 separates these roles into specialized agents. Each agent receives a bounded responsibility and emits activity traces that can be inspected independently.

## Role decomposition

The planner proposes strategy. The executor turns strategy into concrete action. The critic evaluates coherence and risk. The memory agent retrieves relevant context. The world-model agent predicts likely outcomes.

These roles are computational specializations, not claims about biological modules. The design mirrors a general cognitive pattern: complex decisions improve when generation, evidence retrieval, prediction, and critique are separated.

## Parallel dispatch

Agents can run concurrently through `Promise.all` when their inputs are independent. This reduces wall-clock latency and preserves a clear boundary between candidate generation and later arbitration.

Parallelism also produces richer traces. The system can compare what the planner proposed, what the critic objected to, and what the world model predicted before a final decision was selected.

## Activity traces

Every agent emits activity traces to the `agent_activity` index. These traces record role, inputs, outputs, confidence, and timing.

The trace index becomes a diagnostic surface for cognition itself. It supports later meta-cognition, reflection, and arbitration because the system can inspect how each sub-agent contributed to the final action.

## Arbitration preparation

Stage 6 does not complete internal debate. It creates the structured proposals and traces that Stage 7 will score. The architecture first decomposes cognition, then adds a principled mechanism for selecting among competing outputs.

## Artifacts (Tier A)

**Stage covered:** 6, Multi-Agent Decomposition.

**Packages shipped:** `packages/agents/` implements agent interfaces and role-specific agent classes.

**Storage:** Agent activity traces are written to `agent_activity`.

**Tier B:** Runtime evidence requires orchestrator integration and representative tasks that exercise multiple agent roles.

**Quantitative claims:** Claims about performance improvement from decomposition remain pending ablation testing.

*Source code: `packages/agents/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/04-multi-agent.md`.*
