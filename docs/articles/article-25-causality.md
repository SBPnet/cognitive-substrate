# Stage 24: Causal Intelligence

*This article accompanies Stage 24 of the cognitive-substrate project. It describes the causal engine that builds structural causal models, evaluates interventions, and simulates counterfactuals from experience history.*

## Beyond correlation

Memory retrieval finds similarity. Pattern detection finds recurrence. Neither is enough to answer what would change if an action were different.

Stage 24 introduces causal intelligence: explicit representation of dependencies, interventions, and counterfactual outcomes.

## Structural causal models

The causal engine constructs structural models from experience history, world-model predictions, grounded observations, and outcome records. Nodes represent variables or abstractions. Edges represent hypothesized causal influence.

These models are provisional. They encode current evidence and are subject to revision.

## Intervention calculus

The engine distinguishes observation from intervention. Observing that two events co-occur is not the same as changing one and predicting the effect on the other.

This distinction lets the system ask whether a proposed action is likely to cause improvement, rather than merely resemble past successful contexts.

## Counterfactual simulation

Counterfactuals ask how an outcome might have changed under a different action or condition. The engine can compare actual history with plausible alternatives.

Counterfactual reasoning supports failure analysis, policy refinement, and better world-model training.

## Causal abstraction

Causal relationships can exist at multiple levels. Low-level events may aggregate into higher-level causal patterns. The engine supports causal abstraction layers so reasoning can move between detailed traces and system-level explanations.

This connects causal intelligence to recursive abstraction.

## Artifacts (Tier A)

**Stage covered:** 24, Causal Intelligence.

**Packages shipped:** `packages/causal-engine/`.

**Runtime role:** The engine builds structural causal models, computes interventions, simulates counterfactuals, and infers dependencies from experience history.

**Tier B:** Runtime evidence requires grounded observations, action records, and evaluated outcomes.

**Quantitative claims:** Causal accuracy and intervention-value claims remain pending empirical validation.

*Source code: `packages/causal-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/18-causal-intelligence.md`.*
