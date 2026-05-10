# Stage 4: Policy Engine

*This article accompanies Stage 4 of the cognitive-substrate project. It describes the policy engine that converts evaluated outcomes into bounded changes in future behaviour.*

## From evaluation to drift

An adaptive agent must change after experience, but unrestricted change destroys identity and reliability. The policy engine is the component that mediates this tension. It receives `policy.evaluation` events, computes reward deltas, and applies bounded updates to a policy vector store.

The result is controlled policy drift: enough movement to learn, not enough movement to collapse.

## Why policy state comes first

In the implementation sequence, the policy engine appears before the richer reinforcement engine. This ordering is deliberate. The system first needs a durable representation of behavioral state: where policy versions live, how updates are bounded, and how downstream components observe a change.

Stage 9 later expands the reward surface that drives these updates. Stage 4 establishes the container and the safety boundary. Reinforcement then supplies more structured evidence for how that container should move.

## Policy state

Policy state is stored in PostgreSQL for durability and cached in memory for fast access by the orchestrator. Each policy version records weights, metadata, and a snapshot boundary.

Versioning matters because policy is part of the causal context of every action. When an outcome is evaluated, the system must know which policy produced the action being judged.

## Reward deltas

Evaluation events carry outcome information from the agent loop. The policy engine converts these outcomes into reward deltas. Positive deltas strengthen behaviours that produced useful results. Negative deltas weaken behaviours associated with failure, contradiction, or risk.

The update is clamped. A single outcome cannot dominate the policy vector, even if the reward is extreme. This protects the agent from overfitting to isolated successes or failures.

## Emitting policy updates

After applying a drift update, the engine emits `policy.updated`. Downstream systems can refresh cached policy state, record identity side effects, or attach the policy version to future experience events.

This event boundary keeps policy changes observable. Adaptation becomes a traceable sequence rather than hidden mutation.

## Identity side effects

Policy changes are not merely optimization steps. Repeated changes alter the agent's behavioural tendencies. Stage 4 therefore creates the foundation for identity drift, which later stages formalize into narrative self-models and stability constraints.

The engine does not define identity by itself. It produces the longitudinal evidence from which identity formation becomes possible.

## Artifacts (Tier A)

**Stage covered:** 4, Policy Engine.

**Packages shipped:** `packages/policy-engine/`.

**Storage and topics:** The engine stores policy versions in PostgreSQL, consumes `policy.evaluation`, and emits `policy.updated`.

**Tier B:** End-to-end evidence requires evaluated outcomes from the agent loop or test fixtures that simulate them.

**Quantitative claims:** Claims about policy convergence and behavioural improvement remain pending empirical validation.

*Source code: `packages/policy-engine/`. Architecture documentation: `docs/architecture/reinforcement-engine.md`. Companion paper chapter: `docs/paper/03-policy-drift.md`.*
