# Stage 25: Curiosity Engine

*This article accompanies Stage 25 of the cognitive-substrate project. It describes the curiosity engine that rewards information gain, uncertainty reduction, novelty, and autonomous experimentation.*

## Intrinsic motivation

External reward is not enough for open-ended cognition. A system that only optimizes explicit tasks may ignore unknowns that later become important.

Stage 25 introduces curiosity as intrinsic motivation. The engine identifies uncertainty, novelty, and potential information gain, then turns them into exploration pressure.

## Information gain

The core signal is expected information gain. A question, probe, memory retrieval, or action is valuable when it is expected to reduce important uncertainty.

This gives the agent a reason to ask, inspect, test, or simulate even when immediate reward is unclear.

## Novelty detection

Novelty is not automatically useful. The engine distinguishes raw difference from meaningful uncertainty. A novel signal deserves attention when it may change a model, goal, policy, or causal assumption.

This prevents curiosity from becoming distractibility.

## Autonomous experimentation

The engine can propose experiments: bounded actions intended to learn. These may include active inference probes, additional retrieval, alternative plans, or simulated scenarios.

Experiments remain subject to attention, budget, and constitutional constraints.

## Exploration priority

Curiosity influences attention and reinforcement. Unexplored states can receive higher priority when potential information gain is high and risk is acceptable.

This creates a controlled exploration drive that supports long-term learning.

## Artifacts (Tier A)

**Stage covered:** 25, Curiosity Engine.

**Packages shipped:** `packages/curiosity-engine/`.

**Runtime role:** The engine computes information-gain reward, detects novelty, prioritizes uncertainty reduction, and proposes autonomous experiments.

**Tier B:** Runtime evidence requires uncertainty estimates, outcome records, and integration with attention and grounding.

**Quantitative claims:** Information-gain and exploration-value claims remain pending evaluation.

*Source code: `packages/curiosity-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/19-curiosity.md`.*
