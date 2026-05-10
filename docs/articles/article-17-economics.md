# Stage 16: Cognitive Economics

*This article accompanies Stage 16 of the cognitive-substrate project. It describes the budget engine that governs compute allocation, utility thresholds, fast and slow cognition modes, and exhaustion.*

## Compute as a scarce resource

Reasoning is not free. Retrieval, reflection, multi-agent debate, world-model simulation, and reranking all consume latency and compute. Without an economic layer, the architecture can spend too much reasoning on routine tasks and too little on difficult ones.

Stage 16 introduces cognitive economics: explicit budgeting for cognition.

## Agent quotas

The budget engine assigns compute quotas to agents and operations. A task can grant more budget to the critic, the world model, retrieval, or reflection depending on risk and expected value.

Quotas prevent any single subsystem from consuming the entire reasoning budget.

## Utility threshold gating

Not every cognitive operation should run. The engine estimates whether the expected utility of an operation exceeds its cost. Low-value operations are skipped or assigned a cheaper path.

This allows the system to choose between fast and slow cognition modes.

## Fast and slow modes

Fast mode uses cached heuristics, shallow retrieval, and minimal debate. Slow mode uses deeper retrieval, multi-agent critique, world-model simulation, and reflection.

The distinction is operational rather than philosophical. It is a runtime policy for spending scarce compute.

## Exhaustion modeling

Long-running systems can accumulate budget pressure. The engine models cognitive exhaustion as reduced available budget, increased reliance on heuristics, or deferred reflection.

This prevents unbounded deliberation and supports graceful degradation under load.

## Artifacts (Tier A)

**Stage covered:** 16, Cognitive Economics.

**Packages shipped:** `packages/budget-engine/`.

**Runtime role:** The engine manages compute quotas, utility thresholds, fast and slow cognition modes, heuristic cache use, and exhaustion state.

**Tier B:** Runtime evidence requires instrumentation for latency, token use, and operation outcomes.

**Quantitative claims:** Claims about cost reduction or improved allocation remain pending benchmark evidence.

*Source code: `packages/budget-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/10-cognitive-economics.md`.*
