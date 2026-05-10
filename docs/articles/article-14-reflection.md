# Stage 8: Self-Reflection Loop

*This article accompanies Stage 8 of the cognitive-substrate project. It describes the meta-cognitive loop that evaluates reasoning traces, attributes failures, and proposes bounded structural changes.*

## Inspecting cognition

The system has begun to act, debate, and adapt. Stage 8 adds the ability to inspect those processes. Self-reflection reads reasoning traces, outcome records, confidence estimates, and debate artifacts to evaluate how cognition performed.

The goal is not introspective mysticism. It is operational meta-cognition: measuring reasoning quality, identifying failure modes, and proposing improvements under budget constraints.

## Early reflection, not full meta-cognition

This stage appears early because the architecture needs a trace-review mechanism before later systems depend on self-modification proposals. It is intentionally narrow. Stage 8 reviews concrete reasoning and debate artifacts, then emits bounded improvement proposals.

The broader supervisory architecture arrives later in Stage 20, after attention, temporal cognition, budget control, forgetting, affect, and narrative identity provide more surfaces to monitor. Stage 8 is the first reflective instrument; Stage 20 is the mature meta-cognitive control layer.

## Reflection inputs

Reflection consumes traces from the agent loop and arbitration system. These traces expose which memories were retrieved, which candidates were considered, which objections were raised, and which outcome followed.

This evidence allows reflection to distinguish several failure classes: missing context, weak plan, overconfident prediction, poor arbitration weight, or external execution failure.

## Confidence and calibration

The reflection loop evaluates whether confidence matched outcome. A system that is often wrong but uncertain is safer than a system that is wrong and confident. Calibration therefore becomes a first-class signal.

Repeated calibration error can become evidence for policy adjustment, retrieval changes, or additional critique.

## Strategy reflection

Reflection can identify reasoning strategies that work well for some task classes and poorly for others. It can recommend increased retrieval depth, stronger world-model involvement, or stricter critic weighting for future similar contexts.

These recommendations are proposals. They do not directly rewrite the architecture.

## Structural proposals

When reflection detects a repeated structural issue, it emits `selfmod.proposed`. This event marks a possible change to prompts, agent roles, scoring weights, or workflow structure.

Stage 8 deliberately stops at proposal. Later constitutional and self-modification stages determine whether proposals are safe to apply.

## Artifacts (Tier A)

**Stage covered:** 8, Self-Reflection Loop.

**Packages shipped:** `packages/metacog-engine/`.

**Topics:** Reflection emits `selfmod.proposed` when structural changes appear warranted.

**Tier B:** Runtime evidence requires reasoning traces, debate traces, and evaluated outcomes.

**Quantitative claims:** Calibration and strategy-improvement claims remain pending longitudinal evaluation.

*Source code: `packages/metacog-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/14-meta-cognition.md`.*
