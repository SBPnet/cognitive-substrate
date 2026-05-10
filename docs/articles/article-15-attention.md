# Stage 14: Attention Engine

*This article accompanies Stage 14 of the cognitive-substrate project. It describes the attention engine that allocates scarce working-memory and reasoning capacity across competing signals.*

## The need for selection

After the multi-agent society is assembled, the next constraint is attention. A system with memory, goals, policy, and multiple agents can generate more possible context than any reasoning step can use. Intelligence therefore requires selection.

The attention engine routes salience. It decides which memories, goals, signals, interrupts, and agent outputs deserve working-memory budget.

## Salience routing

Salience combines importance, urgency, novelty, goal relevance, affective weight, and risk. A high-salience item is not necessarily pleasant or rewarding. It may be dangerous, surprising, contradictory, or time-sensitive.

The engine uses salience to route items into focus, background monitoring, or suppression.

## Working-memory budget

Working memory is a bounded resource. The attention engine enforces that bound by assigning budget to candidate context items. This prevents retrieval and agent outputs from expanding until the reasoning prompt becomes incoherent.

Budgeting also makes cognition inspectable. A rejected item can be rejected because it did not clear a salience threshold, not because it disappeared inside a black-box context builder.

## Attentional competition

Signals compete for focus. The engine models this as a market in which items bid for attention based on salience. Interrupt lanes allow urgent signals to preempt the current focus when necessary.

This produces a more realistic control structure than static priority ordering. Attention can persist, decay, or shift as conditions change.

## Focus persistence

Focus should not thrash. The engine includes persistence and decay so an active task remains stable unless a competing signal is strong enough to justify a switch.

This balance supports both concentration and responsiveness.

## Artifacts (Tier A)

**Stage covered:** 14, Attention Engine.

**Packages shipped:** `packages/attention-engine/`.

**Runtime role:** The engine manages salience routing, working-memory budgets, attention competition, interrupt lanes, and focus decay.

**Tier B:** Runtime evidence requires integration with memory retrieval, goals, and agent-loop context hydration.

**Quantitative claims:** Claims about improved focus or lower context waste remain pending evaluation.

*Source code: `packages/attention-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/08-attention.md`.*
