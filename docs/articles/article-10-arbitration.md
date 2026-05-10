# Stage 7: Internal Debate and Arbitration

*This article accompanies Stage 7 of the cognitive-substrate project. It describes the mechanism that scores competing agent proposals and selects a single action under coherence, reward, memory, and risk constraints.*

## From proposals to decisions

Multi-agent decomposition creates multiple candidate outputs. Without arbitration, the system has diversity but no decision rule. Stage 7 adds internal debate and scoring.

The arbitration engine evaluates candidate actions produced by specialized agents. It assigns each candidate a score based on coherence, predicted reward, memory alignment, and risk. The highest-scoring candidate becomes the selected action, and the critic annotation is preserved for audit.

## Candidate generation

Internal debate begins by allowing agents to produce alternative interpretations or plans. Diversity is useful because different agents can emphasize different evidence: one may optimize reward, another may notice contradiction, and another may predict downstream failure.

The architecture treats disagreement as signal. A conflict between agents marks uncertainty that should be scored, not hidden.

## Scoring dimensions

Coherence measures whether the proposal is internally consistent and compatible with the current task. Predicted reward estimates likely utility. Memory alignment measures support from retrieved experiences. Risk penalizes actions likely to violate constraints or produce negative outcomes.

The final score is a weighted combination of these dimensions. Weights can later be influenced by policy, affect, and constitutional stability, but Stage 7 establishes the arbitration surface.

## Persisting debate traces

Debate traces are persisted to OpenSearch. Each trace records candidate text, role origin, scores, critic notes, and selected winner.

These records are essential for future self-reflection. A later system cannot improve reasoning strategy unless it can inspect the proposals that were rejected as well as the action that was chosen.

## Decision without certainty

Arbitration does not prove that the selected action is correct. It chooses the best available candidate under explicit scoring assumptions. This distinction keeps the system honest: a decision is a ranked commitment, not a declaration of certainty.

## Artifacts (Tier A)

**Stage covered:** 7, Internal Debate and Arbitration.

**Packages shipped:** `packages/agents/` extends the agent system with arbitration logic.

**Storage:** Debate traces are persisted to OpenSearch for later analysis.

**Tier B:** Runtime evidence requires multiple candidate proposals and a configured scoring function.

**Quantitative claims:** Claims about decision quality remain pending comparison against single-agent baselines.

*Source code: `packages/agents/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/04-multi-agent.md`.*
