---
title: Temporal Telemetry Substrate
chapter: 25
arc: operational-intelligence
status: draft
tags: [clickhouse, telemetry, temporal-memory, operational-intelligence, replay]
---

# Chapter 25. Temporal Telemetry Substrate

*Chapter 25. Companion code: Stage 31 (ClickHouse telemetry layer). See also `docs/articles/article-32-clickhouse-telemetry.md` for the engineering narrative.*

## 25.1 Problem Statement

Operational intelligence requires a persistent temporal substrate. Associative memory can retrieve semantically similar incidents, but raw telemetry demands time-window aggregation, high ingestion throughput, and short-retention hot storage. These access patterns differ from vector search and document retrieval.

The proposed architecture assigns temporal telemetry to ClickHouse. This datastore records high-volume raw events, compressed cognitive events, reinforcement outcomes, and incident replay timelines. It functions as the episodic record of operational behaviour.

## 25.2 Storage Roles

The storage architecture is divided by cognitive function:

| Store | Function | Primary access pattern |
|-------|----------|------------------------|
| PostgreSQL | Configuration and topology | Transactional lookup |
| OpenSearch | Semantic memory and pattern library | Retrieval and similarity |
| ClickHouse | Temporal telemetry and outcome history | Time-window aggregation |

This separation prevents raw telemetry from overwhelming semantic indexes and prevents cognitive artifacts from being discarded under short hot-tier retention policies.

## 25.3 Table Classes

The schema defines three table classes.

The raw telemetry class contains `metrics_raw`, `logs_raw`, and `traces_raw`. These tables preserve observed signals with short retention windows. The cognitive signal class contains `cognitive_events` and `pattern_outcomes`. These tables preserve derived operational primitives and reinforcement history. The replay class contains `incident_reconstruction`, which stores selected incident timelines for retrospective analysis.

The class distinction defines retention strategy. Raw telemetry expires quickly. Cognitive and replay records persist because they contain compressed learning value.

## 25.4 Temporal Indexing

Every table uses a time-based partition key. Ordering keys are selected according to dominant query patterns:

$$K_T = (d, t)$$

where $K_T$ is the table order key, $d$ is the domain identifier for the table, such as `service_id`, `primitive_id`, `pattern_id`, or `incident_id`, and $t$ is timestamp.

This design supports efficient scans for recent primitive activity, pattern success histories, service-specific metric reconstruction, and incident replay.

## 25.5 Cognitive Compression

Let $R$ denote the set of raw telemetry events in a time window and $C$ denote the set of cognitive events derived from them. The compression ratio is:

$$\rho = \frac{|C|}{|R|}$$

where $\rho < 1$ is expected under normal operation because only mapped and cognitively relevant signals become primitive events.

This compression is not lossy in the same sense as arbitrary downsampling. The raw tier remains available for short-window replay, while the cognitive tier preserves the signals selected by the operational primitive mapping.

## 25.6 Replay Function

The `incident_reconstruction` table gives the architecture a replay path. Historical incidents can be processed through updated mappings, revised pattern libraries, or new confidence thresholds. This supports counterfactual evaluation: whether a later version of the system would have detected a prior incident earlier or recommended a better intervention.

Replay converts the telemetry store from a passive archive into an experimental substrate.

## 25.7 Limitations

The substrate does not itself detect anomalies or infer operational meaning. It stores facts and derived signals. Pattern detection, reinforcement, and transfer are implemented by later stages.

The claims in this chapter remain architectural design claims. Query latency, ingestion throughput, compression ratios, and replay effectiveness require empirical validation on production-scale telemetry.

---

*Companion article: `docs/articles/article-32-clickhouse-telemetry.md`. Architecture documentation: `docs/architecture/clickhouse-telemetry.md`. Source code: `packages/clickhouse-telemetry/` and `infra/aiven/clickhouse.tf`.*
