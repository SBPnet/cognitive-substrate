---
title: Operational Primitives for Infrastructure Cognition
chapter: 24
arc: operational-intelligence
status: draft
tags: [operational-intelligence, telemetry, primitives, pattern-detection, reinforcement, transfer]
---

# Chapter 24. Operational Primitives for Infrastructure Cognition

*Chapter 24. Companion code: Stage 30 (operational primitives). See also `docs/articles/article-31-operational-intelligence.md` for the companion engineering narrative.*

---

## 24.1 The Failure Mode of Traditional Monitoring

Production distributed systems generate continuous telemetry: metric series, structured logs, and distributed traces. Existing observability platforms aggregate and alert on this data. They do not learn from it.

Each incident is isolated. Each alert fires without memory of prior alerts. When the same failure mode recurs in a different service three months later, the diagnostic knowledge from the first incident exists only as informal human memory. The monitoring system cannot recognise a known pattern in a new context because it has no model of patterns, no memory of outcomes, and no vocabulary for translating surface-level signals into generalised behavioural dynamics.

The operational intelligence layer described in this part is the architectural response to that limitation. It treats infrastructure telemetry as experience events, compresses those events into a transferable vocabulary, and uses that vocabulary to build a learning substrate that can improve as incidents are mapped, detected, evaluated, and replayed. The strength of that improvement depends on mapping coverage, pattern quality, and outcome feedback.

## 24.2 The Vocabulary Problem

The immediate obstacle to transferable operational knowledge is semantic heterogeneity. A Kafka consumer lag spike, an OpenSearch shard imbalance, and a PostgreSQL WAL overflow are all expressions of the same underlying dynamic: write pressure exceeds read capacity, creating backpressure. In existing monitoring systems, however, they appear under different metric names, different dashboard configurations, and different alert thresholds. Knowledge expressed in Kafka-specific terms cannot be applied to OpenSearch or PostgreSQL without a complete reimplementation.

The solution is a level of abstraction that strips surface representation and preserves behavioural dynamics. This is the role of the operational primitive taxonomy.

## 24.3 The Operational Primitive Taxonomy

An operational primitive is a named category of distributed system behaviour. The taxonomy defined in `packages/abstraction-engine/src/primitives/taxonomy.ts` is closed: a small, stable set of terms that collectively covers the behaviour space of distributed systems at the level of abstraction needed for portable pattern recognition.

The six categories are:

**Flow dynamics:** how data moves through the system. Primitives: `BACKPRESSURE_ACCUMULATION`, `THROUGHPUT_COLLAPSE`, `QUEUE_GROWTH`, `PIPELINE_STALL`, `RETRY_AMPLIFICATION`.

**Resource dynamics:** how compute resources are consumed. Primitives: `RESOURCE_PRESSURE`, `IO_SATURATION`, `CONNECTION_EXHAUSTION`, `MEMORY_PRESSURE`.

**Consistency dynamics:** how state remains synchronised. Primitives: `REPLICATION_LAG`, `STATE_DRIFT`, `INDEX_INCONSISTENCY`, `CACHE_INVALIDATION_STORM`.

**Stability dynamics:** how the system responds to perturbation. Primitives: `OSCILLATION`, `FEEDBACK_AMPLIFICATION`, `CASCADING_FAILURE`, `PARTIAL_RECOVERY`.

**Latency dynamics:** how response time changes. Primitives: `TAIL_LATENCY_EXPANSION`, `RESPONSE_DEGRADATION`, `JITTER_INCREASE`.

**Structural dynamics:** how load is distributed across nodes. Primitives: `LOAD_SKEW`, `HOTSPOT_FORMATION`, `STRUCTURAL_REBALANCE`.

The taxonomy is intentionally small. Adding a primitive requires updating the central enum so all consumers (normaliser, pattern library, mapping DSL) remain consistent. This closure is a design property, not a limitation: the goal is a shared language for distributed system behaviour, not an exhaustive enumeration of every possible metric.

## 24.4 The Normalisation Pipeline

Raw telemetry arrives on the `telemetry.metrics.raw` Kafka topic. The telemetry worker transforms each raw signal into an `OperationalPrimitiveEvent` through metric resolution, intensity computation, trend computation, scope inference, and confidence assignment.

Metric resolution uses a `SystemMapping` to translate service-specific metric names into primitive identifiers. Intensity is a normalised value in [0, 1] derived from a ratio of observed value to baseline. Trend (increasing, stable, or decreasing) is derived from the delta between successive observations. Scope (local or distributed) is inferred from partition, shard, node, or broker labels present in the metric metadata.

Signals with no mapping entry are discarded. This is a deliberate choice: unmapped signals produce no cognitive event and consume no downstream compute. The mapping layer is the point of intentional scope control.

## 24.5 Pattern Detection and Reinforcement

Pattern detection operates on streams of `OperationalPrimitiveEvent` values arriving on the `cognition.primitives` topic. The pattern worker applies sliding-window matching against patterns stored in the `operational_patterns` OpenSearch index. Each pattern is a conjunction of primitives that must co-occur within a configurable time window.

When a pattern matches, the worker emits a `cognition.recommendations` event containing the pattern identifier, matched primitives, confidence, and a recommended intervention. The reinforcement feedback worker then tracks the outcome of each recommendation: when `policy.evaluation` events reference the recommendation, the observed reward score is used to update the pattern's confidence via a bounded exponential moving average.

$$c_{t+1} = \alpha \cdot o + (1 - \alpha) \cdot c_t$$

where $c_t$ is the current confidence, $o \in [0, 1]$ is the observed outcome score, and $\alpha$ is the learning rate. The result is clamped to $[0.1, 0.95]$ to prevent collapse or saturation.

## 24.6 Pattern Transfer

The system mapping DSL enables a form of zero-shot pattern hypothesis transfer. When a new system type is onboarded, an operator defines a `SystemMapping` object that binds the new system's metric names to the existing primitive vocabulary. No pattern retraining is required before applying existing hypotheses. The existing pattern library, built from experience with previously monitored systems, becomes available as prior knowledge for the new system.

This property follows directly from the abstraction: if two different systems express the same behavioural dynamic under different metric names, and both are mapped to the same primitive, then a pattern learned from one can fire on the other. Transfer is not final certainty. It is a structural consequence of the vocabulary design that must be calibrated by local feedback.

## 24.7 Relationship to Earlier Foundations

The operational intelligence layer applies the cognitive architecture established in the preceding chapters to an infrastructure domain. The experience event schema (Chapter 01) is extended by the `OperationalPrimitiveEvent` type. The reinforcement scoring mechanism (Chapter 03) governs pattern confidence updates. The recursive abstraction stack (Chapter 21) provides the hierarchical concept formation that the primitive taxonomy instantiates at its lowest level.

The operational intelligence arc is therefore not a departure from the preceding architecture. It is a demonstration that the same cognitive substrate can be directed at operational telemetry with no structural modification, only a domain-specific vocabulary and a matching normalisation layer.

---

*This chapter section is a draft. Empirical evaluation of pattern detection accuracy, recommendation quality, and cross-system transfer effectiveness remains future work. All quantitative claims in the subsections above are design targets; observed results will be reported in a subsequent revision.*
