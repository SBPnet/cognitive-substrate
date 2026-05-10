# Stage 5: Cognitive Agent Loop

*This article accompanies Stage 5 of the cognitive-substrate project. It describes the closed perceive, retrieve, reason, act, and evaluate loop that turns the memory and policy substrate into an operating agent.*

## Closing the loop

The first four stages build the material conditions for cognition: experience capture, memory retrieval, consolidation, and policy drift. Stage 5 connects them into a runtime loop.

The agent receives input, hydrates context, reasons over that context, executes an action stub, captures the outcome, and emits policy evaluation. This is the first stage where the architecture behaves as a closed adaptive system rather than a set of storage and scoring components.

This article follows [Stage 9: Reinforcement Scoring Engine](article-06-reinforcement.md), because the loop needs an evaluation signal before experience can change later behavior. It leads into [Stage 10: Identity Formation](article-08-identity.md), where repeated evaluated loops become longitudinal continuity.

## Session state

The orchestrator maintains session state. A session binds current input, retrieved memories, active goals, policy state, identity context, and reasoning trace under a durable identifier.

This binding is important because later evaluation must reconstruct the causal context of an action. Without session state, the system can observe outcomes but cannot know which memories or policy version influenced them.

## Context hydration

Before reasoning, the loop retrieves memories, loads active policy, attaches goals, and includes identity context where available. These inputs define the agent's working context.

Hydration is the point where long-term memory becomes short-term cognition. Retrieved memories are no longer inert records. They become active evidence for the next decision.

## Reasoning and action

The reasoning call produces a proposed action and trace. Stage 5 keeps execution deliberately narrow through an action stub. The purpose is to establish the cognitive contract before expanding into broader tool use.

This keeps the loop auditable. The system can inspect why an action was proposed, what context was available, and how the result was evaluated.

## Outcome capture

Every action produces an outcome record. The outcome is written into the experience stream and evaluated for policy learning. The next cycle can retrieve this experience, allowing the system to learn from its own behaviour.

This recursive property is the core of the architecture: cognition produces experience, experience updates memory and policy, and memory and policy condition future cognition.

## Artifacts (Tier A)

**Stage covered:** 5, Cognitive Agent Loop.

**Packages shipped:** `apps/orchestrator/` and the agent interfaces in `packages/agents/`.

**Runtime contract:** The loop hydrates context, performs an LLM reasoning call, executes an action stub, records outcome, and emits policy evaluation.

**Tier B:** End-to-end evidence requires live memory retrieval, policy state, and an LLM-compatible reasoning runtime.

**Quantitative claims:** Claims about task performance remain pending evaluation against agent benchmarks.

*Source code: `apps/orchestrator/` and `packages/agents/`. Architecture status: `docs/architecture/inventory.md`. Companion paper chapter: `docs/paper/01-foundations.md`.*
