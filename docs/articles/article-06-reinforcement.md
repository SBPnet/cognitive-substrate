# Stage 9: Reinforcement Scoring Engine

*This article accompanies Stage 9 of the cognitive-substrate project. It describes the reinforcement scoring engine that combines multiple learning signals into memory priority, policy votes, and identity side effects.*

## Beyond a single reward number

Human feedback, task success, novelty, contradiction, prediction accuracy, and emotional weight are not the same signal. Collapsing them too early into a single reward loses structure that later systems need.

Stage 9 introduces a multi-factor reinforcement engine. It computes scores from several dimensions and applies the result to retrieval priority, policy voting, and identity drift.

## Returning to the policy loop

Stage 4 established bounded policy state before the system had a mature reinforcement surface. Stage 9 returns to that loop with richer evidence. Instead of treating evaluation as one scalar reward, the reinforcement engine preserves the reasons an outcome matters.

This makes the public sequence easier to read as a two-step design: first define where adaptive behavior is allowed to change, then define the learning signals that justify those changes.

## Reinforcement factors

The engine considers importance, novelty, prediction accuracy, emotional weight, contradiction risk, and policy alignment. Each factor captures a different reason an experience might matter.

An experience can be important because it succeeded, because it contradicted a belief, because it was surprising, or because it revealed a risk. The architecture preserves these distinctions long enough for downstream systems to use them.

## Retrieval priority

Reinforcement updates OpenSearch fields that affect retrieval ranking. Memories that repeatedly predict outcomes or support successful decisions become easier to retrieve. Memories associated with failure or unresolved contradiction can be deprioritized or flagged.

This makes retrieval adaptive. The memory system learns not only from semantic similarity but from experienced usefulness.

## Policy votes

The reinforcement engine can emit policy votes. These votes do not directly rewrite policy; they provide evidence to the policy engine.

This separation keeps scoring and policy mutation distinct. Reinforcement says what the outcome suggests. Policy drift decides how much behavioural change is allowed.

## Identity side effects

Repeated reinforcement patterns create pressure on identity. If the system consistently rewards certain strategies, risk tolerances, or goals, those tendencies become part of its longitudinal behavioural profile.

Stage 9 therefore supplies evidence for Stage 10 identity formation while remaining scoped to scoring.

## Artifacts (Tier A)

**Stage covered:** 9, Reinforcement Scoring Engine.

**Packages shipped:** `packages/reinforcement-engine/`.

**Storage and topics:** The engine updates retrieval priority in OpenSearch and emits policy votes.

**Tier B:** Runtime evidence requires evaluated experiences and retrieval records.

**Quantitative claims:** Claims about improved memory prioritization or policy adaptation remain pending evaluation.

*Source code: `packages/reinforcement-engine/`. Architecture documentation: `docs/architecture/reinforcement-engine.md`. Companion paper chapter: `docs/paper/03-policy-drift.md`.*
