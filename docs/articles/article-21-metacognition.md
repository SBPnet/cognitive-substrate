# Stage 20: Meta-Cognition

*This article accompanies Stage 20 of the cognitive-substrate project. It extends the reflection loop into calibrated monitoring of cognitive operations, failure attribution, introspection budgeting, and watchdog agents.*

## Monitoring the monitor

Stage 8 introduced self-reflection over traces. Stage 20 makes meta-cognition a persistent runtime capability. The system estimates confidence for cognitive operations, monitors calibration, attributes failures, and limits recursive introspection.

Meta-cognition is valuable only if it remains bounded. A system can spend all available compute evaluating its own evaluation unless budget is explicit.

## Confidence per operation

The engine attaches confidence estimates to retrieval, planning, prediction, critique, arbitration, and reflection. These estimates are later compared with observed outcomes.

This allows calibration to be measured at the level where failures occur. A world-model calibration error is different from a retrieval calibration error.

## Failure attribution

When outcomes disappoint, meta-cognition attempts to locate the failure. The cause may be missing memory, poor planning, weak critique, overconfident prediction, wrong goal priority, or external execution uncertainty.

Attribution guides repair. Without it, all failures become generic negative reward.

## Recursive budget

The engine enforces introspection budgets. Reflection can improve performance, but repeated self-analysis has diminishing returns and direct cost.

Budgeting prevents recursive loops in which meta-cognition consumes the resources needed for ordinary action.

## Watchdog agents

Watchdog agents monitor for unsafe drift, repeated calibration failure, or stalled cognition. They can trigger reflection, reduce autonomy, or request stricter arbitration depending on policy.

This creates a runtime safety surface before constitutional stability is introduced in Stage 23.

## Artifacts (Tier A)

**Stage covered:** 20, Meta-Cognition.

**Packages shipped:** `packages/metacog-engine/` extends the Stage 8 reflection loop.

**Runtime role:** The engine provides confidence estimation, calibration monitoring, failure attribution, introspection budgeting, and watchdog agents.

**Tier B:** Runtime evidence requires trace histories, predictions, outcomes, and operation-level confidence records.

**Quantitative claims:** Calibration and failure-attribution quality remain pending evaluation.

*Source code: `packages/metacog-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/14-meta-cognition.md`.*
