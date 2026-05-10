# Stage 30: Operational Primitives

*This article accompanies Stage 30 of the cognitive-substrate project. It introduces the operational primitive taxonomy: the system-agnostic vocabulary that allows infrastructure telemetry to be represented as transferable behavioural knowledge.*

---

## The problem with monitoring

Every observability platform does the same thing. A metric crosses a threshold. An alert fires. An engineer is paged. The engineer diagnoses the problem, applies a fix, and closes the ticket.

Three months later, the same failure mode occurs in a different service. The alert fires again. A different engineer, or the same engineer without context, diagnoses the problem from scratch. The knowledge of the first diagnosis exists only in a closed ticket, a Slack thread, and imperfect human memory.

The fundamental limitation of traditional monitoring is that it records events but does not learn from them. Each incident is isolated. Each alert is stateless. The system has no model of the patterns it has seen, no memory of what interventions succeeded, and no capacity to recognize a known failure mode in a new context.

The operational intelligence layer described in this article is the answer to that limitation. It treats infrastructure events as experiences, compresses those experiences into transferable knowledge, and uses that knowledge to detect known failure modes in any system, regardless of vendor or metric-naming convention.

This post opens the operational arc. It introduces the thesis and the shared vocabulary. Later posts separate the storage layer, ingestion worker, pattern detector, feedback loop, and transfer procedure so the implementation can be understood one boundary at a time.

## The vocabulary problem

The immediate obstacle to transferable operational knowledge is vocabulary. A Kafka consumer lag spike, an OpenSearch shard imbalance, and a PostgreSQL WAL overflow are all expressions of the same underlying dynamic: write pressure exceeds read capacity, creating backpressure. But they appear in monitoring systems under completely different metric names, in completely different dashboards, with completely different alert conditions.

If knowledge is expressed in terms of `kafka_consumer_lag`, it cannot be applied to a system that uses `queue_backlog` or `pending_messages` or any other naming convention. The knowledge is bound to the surface representation, not the underlying behaviour.

The solution is to introduce a level of abstraction that strips surface representation and preserves behavioural dynamics. This is the role of the operational primitive taxonomy.

## Operational primitives

An operational primitive is a named category of distributed system behaviour. The taxonomy is closed: six categories covering flow, resource, consistency, stability, latency, and structural dynamics, each containing between three and five named terms. The full taxonomy is defined in `packages/abstraction-engine/src/primitives/taxonomy.ts` and documented formally in `docs/paper/24-operational-primitives.md` §24.3 and `docs/architecture/operational-primitives.md`.

The key property is that the taxonomy covers the entire behaviour space at the level of abstraction needed for portable pattern recognition. Every metric from every vendor maps to one of these terms through a `SystemMapping` object, a plain TypeScript record that binds metric names to primitive identifiers. Built-in mappings ship for Aiven Kafka, OpenSearch, PostgreSQL, and ClickHouse. Custom mappings can be defined for any other system.

The invariant is strict: no operational pattern, no pattern match, and no recommendation may reference a vendor name, product name, cluster identifier, or metric naming convention. The vocabulary is the abstraction, and the abstraction is the enabler of transfer.

## The normalisation pipeline

Raw metric data arrives on the `telemetry.metrics.raw` Kafka topic, emitted by Aiven service integrations and OTEL collectors. The telemetry worker consumes this stream and applies the following transformation:

1. **Write raw rows to ClickHouse.** Every metric data point is persisted to the `metrics_raw` table with a 7-day TTL. This is the ground-truth record for replay and retrospective analysis.

2. **Resolve the metric name to a primitive.** The metric name is looked up in the `SystemMapping` for the originating service. Exact matches take priority over wildcard patterns. Metrics with no mapping are discarded.

3. **Compute intensity, trend, and scope.** Intensity is `value / baseline`, clamped to [0, 1]. Trend is derived from the delta between the current and previous observation. Scope is inferred from the presence of partition, shard, node, or broker labels on the metric.

4. **Emit to Kafka.** The normalised `OperationalPrimitiveEvent` is published to `cognition.primitives`. The raw resolved event is also published to `telemetry.events.normalized` for consumers that want the full normalised record.

5. **Write cognitive events to ClickHouse.** The `cognitive_events` table stores every primitive signal detected. This is the primary learning substrate: the pattern worker and reinforcement worker accumulate evidence from this table over time.

This pipeline runs at Aiven scale without modification. At 1 000+ services emitting metrics every 15 seconds, the `telemetry.metrics.raw` topic is high-volume. Both the topic and `telemetry.events.normalized` use Diskless storage (KIP-1150), which stores segments in object storage rather than on broker-local disks. This eliminates broker disk pressure and reduces storage cost proportionally to the volume retained.

## The pattern library

Once primitives flow into `cognition.primitives`, the pattern worker applies a sliding window of the last five minutes of events and checks which operational patterns are active.

A pattern is a document in the `operational_patterns` OpenSearch index. It contains:

- **signature**: the set of primitives that co-occur to define the pattern
- **precursors**: primitives that typically appear before the signature, enabling early-warning detection
- **outcome**: a human-readable description of the emergent system state
- **interventions**: an ordered list of recommended actions, most impactful first
- **confidence**: the current belief in the pattern, in [0, 1]

When all primitives in a pattern's signature are present in the active window, the pattern is matched and its confidence score is used as the match score. When only precursors are present, a partial match with reduced confidence is emitted as an early warning.

The pattern library ships with five seed patterns covering the most common failure modes in distributed systems: cascading backpressure loops, memory pressure GC storms, structural rebalance storms, connection pool exhaustion cascades, and replication lag divergence. These seed patterns are expressed entirely in primitive vocabulary and apply immediately to any system that produces telemetry, without any system-specific configuration.

## The reinforcement loop

Pattern matching without feedback is incomplete. A pattern that consistently produces wrong recommendations should lose confidence. A pattern that consistently succeeds should gain it.

The reinforcement worker closes this loop. It subscribes to `cognition.recommendations` and `policy.evaluation`. When a recommendation is received, it writes an initial `pattern_outcomes` row to ClickHouse with `outcome = "pending"`. When a policy evaluation message references the same recommendation and includes a reward score, the worker applies a bounded exponential moving average to the pattern's confidence: recent outcomes are weighted more heavily than historical ones, but no single outcome can dominate. The formal update equation and clamping bounds are defined in `docs/paper/24-operational-primitives.md` §24.5.

Over time, the pattern library learns which patterns are reliable. High-confidence patterns are matched and recommended first. Low-confidence patterns are still emitted but with reduced weight. The system develops operational intuition.

## Intelligence transfer

The most consequential property of this architecture is that the pattern library is fully portable. When a new infrastructure environment is onboarded, the process is:

1. Define a `SystemMapping` for the new system's metric naming scheme.
2. Configure the telemetry worker to apply the new mapping.
3. Point the worker at the new environment's metric stream.

The pattern worker immediately begins matching incoming primitives against the existing library. Patterns that have high confidence from the training environment are applied to the new environment from the first event. The reinforcement loop then calibrates confidence for the new environment based on observed outcomes.

No retraining is required. The system does not transfer raw telemetry, embeddings, or dashboards. It transfers a model of distributed system behaviour expressed in a vocabulary that is independent of any specific system. The vocabulary is the portability mechanism.

This is the computational equivalent of an experienced engineer joining a new team. The engineer does not know the specific services, metric names, or alert configurations of the new environment. But they know what backpressure looks like. They know the precursors to a rebalance storm. They know which interventions tend to work. The knowledge transfers because it is expressed at the right level of abstraction.

## ClickHouse as the experience substrate

The temporal intelligence layer built on ClickHouse serves a role analogous to episodic memory in the cognitive architecture. It records what happened, when, and under what conditions. It enables three capabilities that are not possible with short-retention metrics stores:

**Pattern seeding.** When a new system is onboarded, ClickHouse provides historical context. The telemetry worker can query recent `cognitive_events` to establish baselines for intensity computation and to identify patterns that were already present before the formal onboarding.

**Cognitive replay.** The `incident_reconstruction` table stores every event related to an incident under a shared `incident_id`. When the pattern library is updated with a new model or improved mappings, past incidents can be replayed through the updated system to verify that the new model would have detected and recommended correctly.

**Outcome analysis.** The `pattern_outcomes` table enables aggregate success rate analysis across patterns, environments, and time windows. This data can inform decisions about which patterns to promote, which to retire, and where mapping coverage is weak.

## What this does not do

The operational intelligence layer is not a general-purpose anomaly detection system. It does not detect arbitrary metric anomalies through statistical methods alone. It detects known behavioural patterns expressed in a defined vocabulary. Adding new failure modes requires authoring new patterns; the system does not discover them autonomously.

The layer also does not remediate automatically. Recommendations are emitted to `cognition.recommendations` and displayed in dashboards. Acting on them is an operator decision. Autonomous remediation would require additional safety controls, policy layers, and approval gates that are out of scope for these stages.

What the layer does is reduce the cognitive load of incident response. When an engineer receives an alert, the system has already identified the most probable failure pattern, listed the recommended interventions in priority order, and provided the confidence score based on historical outcomes. The engineer makes the decision with more context and less diagnosis time.

## What comes next

Stage 36 formalises the transfer mechanism as a documented onboarding procedure, including the interface for defining custom `SystemMapping` objects, the tooling for importing mappings from OpenTelemetry semantic convention metadata, and the validation process for verifying that a new mapping produces correct primitive classifications before deployment.

Beyond Stage 36, the operational intelligence layer becomes a foundation for more ambitious capabilities: multi-environment correlation (detecting patterns that span systems), temporal pattern recognition (detecting patterns that unfold over hours or days rather than minutes), and eventually the kind of operational intuition that experienced engineers develop over years and that this architecture is designed to encode, preserve, and transfer.

## Artifacts (Tier A)

**Stage covered:** 30, Operational Primitives.

**Packages shipped:** `packages/abstraction-engine/src/primitives/` defines the taxonomy, normaliser, pattern library, and mapping layer.

**Related stages:** Stages 31 through 36 implement the ClickHouse telemetry substrate, telemetry worker, pattern worker, reinforcement worker, ML inference nodes, and intelligence transfer procedure that build on this vocabulary.

**Tier B:** End-to-end pipeline execution requires later stages. Stage 30 evidence consists of the taxonomy, built-in mappings, and seed patterns.

**Quantitative claims in the companion chapter** (pattern detection accuracy, recommendation quality, cross-system transfer effectiveness) are design proposals pending empirical evaluation. The chapter marks these claims accordingly.

---

*Source code: `packages/abstraction-engine/src/primitives/`. Architecture documentation: `docs/architecture/operational-primitives.md`. Companion paper chapter: `docs/paper/24-operational-primitives.md`.*
