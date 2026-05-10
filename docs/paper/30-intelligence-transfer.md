---
title: Transfer of Operational Intelligence Across Systems
chapter: 30
arc: operational-intelligence
status: draft
tags: [transfer, mappings, primitives, generalization, operational-intelligence]
---

# Chapter 30. Transfer of Operational Intelligence Across Systems

*Chapter 30. Companion code: Stage 36 (intelligence transfer). See also `docs/articles/article-36-intelligence-transfer.md` for the engineering narrative.*

## 30.1 Transfer Hypothesis

The central hypothesis of the operational intelligence arc is that operational knowledge transfers across infrastructure systems when represented at the level of behavioural primitives rather than product-specific telemetry.

Let two systems $A$ and $B$ expose different metric vocabularies. Transfer is possible when mappings $M_A$ and $M_B$ project both vocabularies into the same primitive space $\Pi$:

$$M_A: V_A \rightarrow \Pi$$

$$M_B: V_B \rightarrow \Pi$$

Patterns over $\Pi$ can then be evaluated on either system.

## 30.2 System Mapping as Grounding

A `SystemMapping` grounds abstract primitives in concrete telemetry names. It is the only component that should contain vendor metric vocabulary. The normaliser, pattern worker, reinforcement worker, and pattern library operate after this translation step.

This boundary preserves the system-agnostic invariant. Patterns must not reference service names, metric names, cluster identifiers, or topology-specific labels.

## 30.3 Zero-Shot Application

Given a pattern $P$ defined over primitives and a new system mapping $M_B$, pattern application can begin as soon as the telemetry worker emits primitive events for system $B$.

No local retraining is required for initial matching. The pattern library supplies prior hypotheses about distributed-system behaviour. These hypotheses may be wrong in the new environment, but they are operationally usable before local history accumulates.

## 30.4 Local Calibration

Transferred pattern confidence is a prior. Local reinforcement turns that prior into an environment-calibrated estimate.

Let $c_0$ be inherited confidence for a pattern and $O_B$ be outcome history in the new environment. The calibrated confidence after feedback is:

$$c_B = update(c_0, O_B)$$

where `update` is the bounded moving-average process defined in Chapter 28.

This distinction separates transfer from certainty. The system begins with cross-system knowledge and then adapts it locally.

## 30.5 Transfer Scope

The transferable unit is a behavioural pattern. Raw metric thresholds, dashboards, topology assumptions, and product-specific remediation commands do not transfer reliably.

An abstract intervention such as reducing ingress pressure can transfer. The concrete action that realizes it remains system-specific and may require a runbook, policy gate, or operator decision.

## 30.6 Failure Modes

Transfer can fail through poor mapping coverage, incorrect primitive assignment, pattern overgeneralization, or intervention mismatch. These failures are detectable through low recommendation success, high ignored outcome rates, or replay disagreement against labelled incidents.

The architecture therefore treats transfer as a hypothesis subject to reinforcement rather than a guaranteed property of all patterns.

## 30.7 Evaluation Criteria

Cross-system transfer should be evaluated by comparing detection and recommendation quality before and after local outcome history accumulates. Relevant metrics include zero-shot match precision, time-to-useful-diagnosis, confidence calibration error, and intervention success rate.

Empirical validation remains future work.

---

*Companion article: `docs/articles/article-36-intelligence-transfer.md`. Architecture documentation: `docs/architecture/operational-primitives.md`. Source code: `packages/abstraction-engine/src/primitives/mapping-layer.ts`, `apps/workers/telemetry/`, `apps/workers/pattern/`, and `apps/workers/reinforcement/`.*
