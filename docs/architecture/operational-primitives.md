# Operational Primitives

## Purpose

Operational primitives are the system-agnostic vocabulary the architecture uses to describe distributed system behaviour. They are the abstraction unit that makes learned patterns portable across different infrastructure environments.

Without this abstraction, patterns learned from Aiven Kafka would be expressed in terms of `consumer_lag`, `partition_skew`, and `broker_cpu_idle`. These names are specific to Kafka and Aiven's metric naming conventions. They cannot be transferred to a different system without rewriting every pattern.

With operational primitives, the same pattern is expressed as `BACKPRESSURE_ACCUMULATION + LOAD_SKEW + RESOURCE_PRESSURE`. These terms describe behavioural dynamics that occur in any distributed system regardless of vendor, product, or metric naming scheme.

## The Primitive Taxonomy

The taxonomy is defined as a closed enum in `packages/abstraction-engine/src/primitives/taxonomy.ts`. The categories are:

**Flow dynamics** (how data moves through the system):
`BACKPRESSURE_ACCUMULATION`, `THROUGHPUT_COLLAPSE`, `QUEUE_GROWTH`, `PIPELINE_STALL`, `RETRY_AMPLIFICATION`

**Resource dynamics** (how compute resources are consumed):
`RESOURCE_PRESSURE`, `IO_SATURATION`, `CONNECTION_EXHAUSTION`, `MEMORY_PRESSURE`

**Consistency dynamics** (how state stays synchronised):
`REPLICATION_LAG`, `STATE_DRIFT`, `INDEX_INCONSISTENCY`, `CACHE_INVALIDATION_STORM`

**Stability dynamics** (how the system responds to perturbation):
`OSCILLATION`, `FEEDBACK_AMPLIFICATION`, `CASCADING_FAILURE`, `PARTIAL_RECOVERY`

**Latency dynamics** (how response time changes):
`TAIL_LATENCY_EXPANSION`, `RESPONSE_DEGRADATION`, `JITTER_INCREASE`

**Structural dynamics** (how load is distributed across nodes):
`LOAD_SKEW`, `HOTSPOT_FORMATION`, `STRUCTURAL_REBALANCE`

The taxonomy is intentionally small and closed. Adding a new primitive requires updating the enum so all consumers (normaliser, pattern library, mapping DSL) stay consistent.

## The Normalisation Pipeline

Raw telemetry signals arrive on the `telemetry.metrics.raw` Kafka topic. The telemetry worker converts them to `OperationalPrimitiveEvent` objects using the following steps:

1. **Metric resolution**: the metric name is looked up in the `SystemMapping` for the originating service. Exact matches take priority over wildcard patterns.
2. **Intensity computation**: if a baseline value is available, intensity = `value / baseline`, clamped to [0, 1]. Otherwise 0.5 is used as a neutral default.
3. **Trend computation**: comparing `value` to `previousValue` determines whether the primitive is `increasing`, `stable`, or `decreasing`.
4. **Scope inference**: if the metric carries partition, shard, node, or broker labels it is classified as `local`; otherwise `distributed`.
5. **Confidence assignment**: exact metric name match produces confidence 0.9; wildcard match produces 0.65.

Signals with no mapping entry are silently discarded.

## The System Mapping DSL

A `SystemMapping` is the adapter definition that binds a specific service type to the primitive vocabulary. It is a plain TypeScript object:

```typescript
const AIVEN_KAFKA_MAPPING: SystemMapping = {
  systemId: "aiven.kafka",
  systemType: "streaming",
  metricMappings: {
    "consumer_lag":               "BACKPRESSURE_ACCUMULATION",
    "partition_count_skew":       "LOAD_SKEW",
    "broker_cpu_idle":            "RESOURCE_PRESSURE",
    "kafka_consumer_lag*":        "BACKPRESSURE_ACCUMULATION",
    // ...
  },
};
```

Built-in mappings for Aiven Kafka, OpenSearch, PostgreSQL, and ClickHouse ship in `packages/abstraction-engine/src/primitives/mapping-layer.ts`. Additional mappings can be supplied to the telemetry worker at runtime.

## The Pattern Library

Patterns are stored in the `operational_patterns` OpenSearch index and in the `SEED_PATTERNS` array inside the package. Each pattern document contains:

- `signature`: the co-occurring primitives that define the pattern
- `precursors`: primitives that typically appear before the signature, enabling early-warning detection
- `outcome`: a human-readable description of the emergent system state
- `interventions`: ordered list of recommended actions
- `confidence`: current belief in the pattern, updated by the reinforcement loop
- `observationCount` / `successCount`: evidence accumulators

Example:

```json
{
  "patternId": "P_CASCADING_BACKPRESSURE_LOOP",
  "signature": ["BACKPRESSURE_ACCUMULATION", "QUEUE_GROWTH", "RETRY_AMPLIFICATION"],
  "precursors": ["LOAD_SKEW", "TAIL_LATENCY_EXPANSION"],
  "outcome": "Consumer lag grows while retries amplify producer load...",
  "interventions": [
    "Reduce ingestion rate or apply producer throttling",
    "Increase consumer parallelism or partition count"
  ],
  "confidence": 0.85
}
```

## The Transfer / Intelligence Cloning Model

When the system is pointed at a new infrastructure environment, only the `SystemMapping` changes. The pattern library, normaliser, and pattern worker remain unchanged because they operate on primitives, not vendor metrics.

The transfer process:

1. Define a `SystemMapping` for the new system's metric naming scheme.
2. Configure the telemetry worker to use the new mapping.
3. The pattern worker immediately begins matching incoming primitives against the existing pattern library.
4. The reinforcement worker tracks which patterns fire and whether they succeed, updating confidence scores for the new environment.
5. Over time, the pattern library acquires evidence from the new system, improving the confidence of patterns that generalise well and suppressing those that do not.

No retraining is required. The system transfers learned dynamics, not raw telemetry.

## Invariant

Every field in `OperationalPattern` must be free of vendor names, product names, cluster identifiers, or metric-naming conventions. The `systemAgnostic: true` field is enforced in the TypeScript type definition to make violations a compile-time error.
