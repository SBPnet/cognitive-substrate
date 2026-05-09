import type { OperationalPrimitiveId } from "./taxonomy.js";

/**
 * A system-agnostic operational pattern stored in the pattern library.
 *
 * Invariants:
 *   - signature, precursors, and outcome must not reference any vendor,
 *     product, cluster, or metric name.  Use OperationalPrimitiveId values only.
 *   - systemAgnostic is a phantom field enforced at the type level to make
 *     accidental system-specific patterns a compile-time error.
 */
export interface OperationalPattern {
  readonly patternId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * The combination of primitives that together define this pattern.
   * All listed primitives must be co-occurring within the detection window.
   */
  readonly signature: ReadonlyArray<OperationalPrimitiveId>;
  /**
   * Primitives that typically appear before the signature primitives.
   * Used for early-warning detection.
   */
  readonly precursors: ReadonlyArray<OperationalPrimitiveId>;
  /** Human-readable description of the emergent system state. */
  readonly outcome: string;
  /**
   * Ordered list of recommended interventions, most impactful first.
   * Each entry is a system-agnostic action description.
   */
  readonly interventions: ReadonlyArray<string>;
  /** Confidence in this pattern, in [0, 1].  Updated by the reinforcement loop. */
  readonly confidence: number;
  /** Total number of times this pattern has been observed. */
  readonly observationCount: number;
  /** Number of observations where the recommended intervention succeeded. */
  readonly successCount: number;
  readonly systemAgnostic: true;
}

/** Subset of an OperationalPattern returned by similarity search. */
export interface PatternMatch {
  readonly pattern: OperationalPattern;
  /** Similarity score from the OpenSearch k-NN or BM25 query, in [0, 1]. */
  readonly matchScore: number;
}

// ----------------------------------------------------------------
// Seed patterns
// Built-in patterns based on known failure modes in distributed systems.
// The pattern worker loads these on startup if the operational_patterns
// index is empty, then learns and updates confidence from observations.
// ----------------------------------------------------------------

const now = new Date("2026-01-01T00:00:00Z");

export const SEED_PATTERNS: ReadonlyArray<OperationalPattern> = [
  {
    patternId: "P_CASCADING_BACKPRESSURE_LOOP",
    createdAt: now,
    updatedAt: now,
    signature: ["BACKPRESSURE_ACCUMULATION", "QUEUE_GROWTH", "RETRY_AMPLIFICATION"],
    precursors: ["LOAD_SKEW", "TAIL_LATENCY_EXPANSION"],
    outcome: "Cascading backpressure loop: consumer lag grows while retries amplify producer load, eventually collapsing throughput across the pipeline.",
    interventions: [
      "Reduce ingestion rate or apply producer throttling",
      "Increase consumer parallelism or partition count",
      "Isolate hot partitions and redistribute load",
      "Enable dead-letter queuing to shed irrecoverable messages",
    ],
    confidence: 0.85,
    observationCount: 0,
    successCount: 0,
    systemAgnostic: true,
  },
  {
    patternId: "P_MEMORY_PRESSURE_GC_STORM",
    createdAt: now,
    updatedAt: now,
    signature: ["MEMORY_PRESSURE", "TAIL_LATENCY_EXPANSION", "THROUGHPUT_COLLAPSE"],
    precursors: ["QUEUE_GROWTH", "RESOURCE_PRESSURE"],
    outcome: "Memory pressure causing GC storms: heap saturation triggers frequent GC pauses which inflate tail latency and reduce effective throughput.",
    interventions: [
      "Increase heap allocation for affected nodes",
      "Enable off-heap or compressed object storage",
      "Reduce batch sizes to lower peak heap usage",
      "Trigger voluntary GC before pressure becomes critical",
    ],
    confidence: 0.80,
    observationCount: 0,
    successCount: 0,
    systemAgnostic: true,
  },
  {
    patternId: "P_STRUCTURAL_REBALANCE_STORM",
    createdAt: now,
    updatedAt: now,
    signature: ["STRUCTURAL_REBALANCE", "IO_SATURATION", "RESPONSE_DEGRADATION"],
    precursors: ["LOAD_SKEW", "REPLICATION_LAG"],
    outcome: "Rebalance storm: concurrent shard or partition movements saturate I/O bandwidth and degrade query response times across the cluster.",
    interventions: [
      "Throttle rebalance bandwidth to reduce I/O contention",
      "Schedule rebalances during low-traffic windows",
      "Increase replica throttle limits temporarily",
      "Pause non-critical indexing during rebalance",
    ],
    confidence: 0.78,
    observationCount: 0,
    successCount: 0,
    systemAgnostic: true,
  },
  {
    patternId: "P_CONNECTION_EXHAUSTION_CASCADE",
    createdAt: now,
    updatedAt: now,
    signature: ["CONNECTION_EXHAUSTION", "BACKPRESSURE_ACCUMULATION", "CASCADING_FAILURE"],
    precursors: ["RESOURCE_PRESSURE", "QUEUE_GROWTH"],
    outcome: "Connection pool exhaustion causing cascade: new requests queue or fail immediately, propagating errors upstream and triggering retry amplification.",
    interventions: [
      "Increase connection pool size or add connection multiplexing",
      "Enable circuit breakers to shed load before pool exhaustion",
      "Identify and close stale or leaked connections",
      "Scale horizontally to distribute connection load",
    ],
    confidence: 0.82,
    observationCount: 0,
    successCount: 0,
    systemAgnostic: true,
  },
  {
    patternId: "P_REPLICATION_LAG_DIVERGENCE",
    createdAt: now,
    updatedAt: now,
    signature: ["REPLICATION_LAG", "STATE_DRIFT", "IO_SATURATION"],
    precursors: ["THROUGHPUT_COLLAPSE", "RESOURCE_PRESSURE"],
    outcome: "Replication lag widening into state divergence: sustained write load saturates replication I/O, causing replicas to fall behind and read consistency to degrade.",
    interventions: [
      "Throttle writes to allow replicas to catch up",
      "Increase network bandwidth or replication threads",
      "Temporarily reduce replication factor to reduce overhead",
      "Monitor and alert on lag thresholds before divergence occurs",
    ],
    confidence: 0.76,
    observationCount: 0,
    successCount: 0,
    systemAgnostic: true,
  },
];
