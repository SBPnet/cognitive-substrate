---
title: Telemetry Normalisation as Cognitive Translation
chapter: 26
arc: operational-intelligence
status: draft
tags: [telemetry, normalisation, primitives, kafka, translation]
---

# Chapter 26. Telemetry Normalisation as Cognitive Translation

*Chapter 26. Companion code: Stage 32 (telemetry ingestion worker). See also `docs/articles/article-33-telemetry-ingestion.md` for the engineering narrative.*

## 26.1 Translation Boundary

The telemetry worker defines the boundary between raw observability data and cognitive representation. The primary paper contract is the metrics path: it consumes metric messages from `telemetry.metrics.raw`, persists the raw rows, and emits operational primitive events to `cognition.primitives`.

Logs, traces, and richer metadata can be incorporated through the same translation pattern, but they are extensions of the primary metrics contract rather than evidence assumed by this chapter.

This boundary is a translation layer. The input vocabulary is local to a service or vendor. The output vocabulary is system-agnostic and constrained by the closed operational primitive taxonomy introduced in Chapter 24.

## 26.2 Signal Model

A raw telemetry signal can be represented as:

$$s = (m, v, b, p, l, \tau, e)$$

where $m$ is metric name, $v$ is observed value, $b$ is baseline, $p$ is previous value, $l$ is the label map, $\tau$ is timestamp, and $e$ is environment.

The normaliser maps $s$ to an operational primitive event:

$$n(s) = (\pi, i, r, q, \gamma, h, \tau)$$

where $\pi$ is primitive identifier, $i$ is intensity, $r$ is trend, $q$ is scope, $\gamma$ is mapping confidence, $h$ is source system metadata, and $\tau$ is timestamp.

## 26.3 Metric Resolution

Metric resolution is governed by a `SystemMapping`. Exact metric names take precedence over wildcard patterns. If no mapping entry matches, the signal produces no primitive event.

This discard rule is a cognitive filter. It prevents unmapped observability noise from entering the pattern detector. Because the raw signal is still written to ClickHouse, discarded signals remain available for mapping coverage analysis and replay.

## 26.4 Intensity, Trend, and Scope

Intensity is a normalized estimate of signal strength:

$$i = \min(1, \frac{v}{b})$$

where $v$ is the observed value and $b$ is the baseline. If no baseline is available, the implementation uses a neutral default.

Trend is derived from the relation between current and previous values. Scope is inferred from labels: partition, shard, node, or broker labels indicate local scope; otherwise the event is treated as distributed.

## 26.5 Dual Publication

The worker publishes two Kafka streams. `telemetry.events.normalized` preserves the relationship between raw metric messages and resolved primitive identifiers. `cognition.primitives` carries the compact primitive event stream consumed by the pattern worker.

The distinction preserves observability of the translation process while keeping the cognitive stream independent from raw metric naming conventions.

## 26.6 Correctness Criteria

Normalisation correctness has three dimensions. Coverage measures the fraction of relevant raw signals that resolve to primitives. Precision measures whether resolved primitives reflect the intended behavioural dynamic. Stability measures whether the same metric stream maps consistently across deployments.

These criteria can be evaluated through replay against `metrics_raw` and comparison against curated incident labels. Empirical evaluation remains future work.

## 26.7 Relationship to Transfer

Normalisation is the mechanism that makes transfer possible. A pattern can only transfer if distinct systems emit the same primitive sequence for the same behavioural dynamic. The mapping layer therefore provides the grounding function for the operational intelligence arc: it binds abstract operational knowledge to concrete telemetry.

---

*Companion article: `docs/articles/article-33-telemetry-ingestion.md`. Architecture documentation: `docs/architecture/operational-primitives.md` and `docs/architecture/clickhouse-telemetry.md`. Source code: `apps/workers/telemetry/` and `packages/abstraction-engine/src/primitives/`.*
