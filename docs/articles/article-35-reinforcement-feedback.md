# Stage 34: Reinforcement Feedback Worker

*This article accompanies Stage 34 of the cognitive-substrate project. It describes the feedback loop that records recommendation outcomes and adjusts operational pattern confidence over time.*

## Why recommendations need outcomes

Pattern detection is incomplete without feedback. A detector can emit plausible recommendations, but plausibility is not the same as operational value. The system must learn which recommendations consistently help, which are partially useful, and which produce little improvement.

The reinforcement feedback worker closes that loop. It observes recommendation events, records pending outcomes, accepts later feedback from policy evaluation or an operator-facing feedback surface, and updates pattern confidence in OpenSearch.

## Recommendation tracking

When a `cognition.recommendations` event arrives, the worker writes an initial `pattern_outcomes` row with `outcome = "pending"`. The row records the recommendation identifier, pattern identifier, match score as `confidence_before`, timestamp, and environment.

This pending row creates a durable join point. Outcome feedback may arrive later, after an operator acts or after the monitored service stabilizes. The recommendation identifier ties the action and result back to the original pattern match.

## Outcome recording

Outcome feedback records the action taken, outcome class, optional latency delta, and confidence before the update. The current implementation recognizes `success`, `partial`, `failure`, and `ignored`.

Each outcome class maps to an outcome signal. Success maps to 1.0, partial maps to 0.5, failure maps to 0.0, and ignored maps to 0.5. The neutral value for ignored recommendations prevents missing action from being treated as evidence that the pattern was wrong.

The worker writes a completed `pattern_outcomes` row to ClickHouse and updates the corresponding pattern document in OpenSearch. OpenSearch remains the serving store for pattern confidence, while ClickHouse remains the analytical record of every update.

## Confidence update

The confidence update is a bounded exponential moving average:

$$c_{t+1} = \alpha o + (1 - \alpha)c_t$$

where $c_t$ is the prior confidence, $o$ is the outcome signal, and $\alpha$ is the learning rate. The implementation defaults to $\alpha = 0.15$ and clamps the result to a minimum of 0.1 and a maximum of 0.99.

The moving average gives recent evidence weight without allowing one incident to dominate the pattern's history. Clamping prevents patterns from becoming either impossible to recover or impossible to challenge.

## Evidence before automation

This stage does not automate remediation. It builds evidence for trust. A high-confidence pattern with a strong outcome history can later become eligible for guarded automation. A low-confidence pattern remains useful as a hypothesis but should not drive unattended action.

By separating recommendation, outcome tracking, and confidence calibration, the architecture can mature from advisory diagnostics toward automation without hiding the evidence trail.

## Artifacts (Tier A)

**Stage covered:** 34, Reinforcement Feedback Worker.

**Packages shipped:** `apps/workers/reinforcement/` implements recommendation tracking, outcome recording, ClickHouse persistence, and OpenSearch confidence updates.

**Storage and topics:** The worker consumes `cognition.recommendations` and `policy.evaluation`, writes `pattern_outcomes`, and updates `operational_patterns`.

**Tier B:** End-to-end evidence requires a recommendation event and a later policy evaluation or feedback message referencing the same recommendation identifier.

**Quantitative claims:** Claims about confidence convergence and recommendation quality remain design proposals pending outcome history.

*Source code: `apps/workers/reinforcement/` and `packages/clickhouse-telemetry/`. Architecture documentation: `docs/architecture/clickhouse-telemetry.md` and `docs/architecture/operational-primitives.md`. Companion paper chapter: `docs/paper/28-reinforcement-feedback.md`.*
