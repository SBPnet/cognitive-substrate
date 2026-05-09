/**
 * System-agnostic vocabulary of distributed system behaviour.
 *
 * Operational primitives are the canonical abstraction unit used throughout
 * the pattern library and transfer layer.  Every string in this enum must
 * describe a *behavioural dynamic* — never a vendor, product, or metric name.
 *
 * The taxonomy is closed by design: adding a new primitive requires updating
 * this enum so that all consumers (normaliser, pattern library, mapping DSL)
 * remain consistent.  Use the COMPOSITE category for emergent multi-primitive
 * situations that do not fit any existing entry.
 */
export const OperationalPrimitive = {
  // ----------------------------------------------------------------
  // Flow dynamics
  // ----------------------------------------------------------------

  /** Upstream producers are writing faster than downstream consumers can process. */
  BACKPRESSURE_ACCUMULATION: "BACKPRESSURE_ACCUMULATION",

  /** Sustained drop in message or request throughput below baseline. */
  THROUGHPUT_COLLAPSE: "THROUGHPUT_COLLAPSE",

  /** Queue or backlog depth is growing monotonically. */
  QUEUE_GROWTH: "QUEUE_GROWTH",

  /** A pipeline stage has stalled and is neither processing nor shedding load. */
  PIPELINE_STALL: "PIPELINE_STALL",

  /** Retry attempts are amplifying total load (retry storm). */
  RETRY_AMPLIFICATION: "RETRY_AMPLIFICATION",

  // ----------------------------------------------------------------
  // Resource dynamics
  // ----------------------------------------------------------------

  /** CPU, memory, or thread-pool is approaching or at capacity. */
  RESOURCE_PRESSURE: "RESOURCE_PRESSURE",

  /** Disk or network I/O is saturated. */
  IO_SATURATION: "IO_SATURATION",

  /** Connection pool or descriptor limit is being exhausted. */
  CONNECTION_EXHAUSTION: "CONNECTION_EXHAUSTION",

  /** Heap or off-heap memory is under pressure; GC activity is elevated. */
  MEMORY_PRESSURE: "MEMORY_PRESSURE",

  // ----------------------------------------------------------------
  // Consistency dynamics
  // ----------------------------------------------------------------

  /** Replication lag between primary and secondary nodes is widening. */
  REPLICATION_LAG: "REPLICATION_LAG",

  /** State divergence detected between nodes that should be consistent. */
  STATE_DRIFT: "STATE_DRIFT",

  /** Index or shard state is internally inconsistent. */
  INDEX_INCONSISTENCY: "INDEX_INCONSISTENCY",

  /** Cache entries are being invalidated faster than they are repopulated. */
  CACHE_INVALIDATION_STORM: "CACHE_INVALIDATION_STORM",

  // ----------------------------------------------------------------
  // Stability dynamics
  // ----------------------------------------------------------------

  /** System metric oscillates around a threshold rather than stabilising. */
  OSCILLATION: "OSCILLATION",

  /** Feedback loop is amplifying instability rather than damping it. */
  FEEDBACK_AMPLIFICATION: "FEEDBACK_AMPLIFICATION",

  /** Failure in one component is propagating to dependent components. */
  CASCADING_FAILURE: "CASCADING_FAILURE",

  /** System is recovering but not yet at baseline; stability is fragile. */
  PARTIAL_RECOVERY: "PARTIAL_RECOVERY",

  // ----------------------------------------------------------------
  // Latency dynamics
  // ----------------------------------------------------------------

  /** P95/P99 latency is widening while median remains stable. */
  TAIL_LATENCY_EXPANSION: "TAIL_LATENCY_EXPANSION",

  /** Broad latency increase across all percentiles. */
  RESPONSE_DEGRADATION: "RESPONSE_DEGRADATION",

  /** Latency variance (jitter) is increasing. */
  JITTER_INCREASE: "JITTER_INCREASE",

  // ----------------------------------------------------------------
  // Structural dynamics
  // ----------------------------------------------------------------

  /** Load is unevenly distributed across partitions, shards, or nodes. */
  LOAD_SKEW: "LOAD_SKEW",

  /** A specific node, partition, or shard is receiving disproportionate traffic. */
  HOTSPOT_FORMATION: "HOTSPOT_FORMATION",

  /** Shard or partition rebalancing is in progress, causing transient overhead. */
  STRUCTURAL_REBALANCE: "STRUCTURAL_REBALANCE",

  // ----------------------------------------------------------------
  // Composite / emergent
  // ----------------------------------------------------------------

  /** Multiple primitive dynamics are co-occurring in a way that cannot be
   *  assigned to a single category.  Used sparingly and only when no single
   *  primitive adequately describes the observed behaviour. */
  COMPOSITE: "COMPOSITE",
} as const;

export type OperationalPrimitiveId = keyof typeof OperationalPrimitive;
