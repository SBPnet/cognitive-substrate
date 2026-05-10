# Stage 10: Identity Formation

*This article accompanies Stage 10 of the cognitive-substrate project. It describes the formation of a longitudinal identity model from reinforced experience, policy drift, and narrative coherence.*

## Identity as accumulated constraint

An adaptive system changes over time. Without an identity model, that change is only a sequence of local updates. Stage 10 introduces a structure that summarizes persistent tendencies: what the system tends to value, avoid, repeat, and revise.

Identity is not a fixed persona. It is a slowly changing model of behavioural continuity.

## Identity vector accumulation

The narrative engine accumulates an identity vector from reinforcement history. Repeated outcomes shift the vector toward stable traits: caution, exploration, precision, speed, social deference, or other dimensions represented by the implementation.

The vector changes slowly. This prevents short-term reward fluctuations from rewriting the agent's self-model.

## Narrative synthesis

A vector is not enough for introspection or audit. The system also synthesizes a narrative self-model: a structured summary of long-running goals, characteristic strategies, repeated failures, and stable preferences.

The narrative gives later reflection and policy systems a human-readable account of continuity. It also creates a surface for contradiction detection when behaviour diverges from the stated self-model.

## Coherence scoring

Identity requires coherence. The engine scores whether recent behaviour aligns with the existing narrative and policy history. Low coherence does not automatically imply error, because genuine learning can change identity. It does mark a transition that deserves attention.

Coherence scoring is the bridge between adaptation and stability.

## Emitting updates

When identity changes enough to matter, the engine emits `identity.updated`. The orchestrator can then include the updated identity context in future reasoning loops.

This closes a long arc: past behaviour shapes identity, identity shapes future context, and future outcomes reshape identity again.

## Artifacts (Tier A)

**Stage covered:** 10, Identity Formation.

**Packages shipped:** `packages/narrative-engine/`.

**Topics:** The engine emits `identity.updated` when the identity model changes.

**Tier B:** Runtime evidence requires reinforcement history and policy version history.

**Quantitative claims:** Claims about identity coherence and stability remain pending longitudinal evaluation.

*Source code: `packages/narrative-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/07-stability-emergence.md`.*
