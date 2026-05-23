import type { OperationalPrimitiveId } from "./taxonomy.js";

/**
 * System mapping DSL — the adapter definition that binds a specific
 * infrastructure environment to the system-agnostic primitive vocabulary.
 *
 * Rules for a valid mapping:
 *   1. metricMappings keys must be vendor metric names (not primitive names).
 *   2. Values must be OperationalPrimitiveId constants.
 *   3. No system names, cluster IDs, or topology references may appear in the
 *      OperationalPrimitiveId values — they are already system-agnostic.
 *   4. Wildcard patterns use a trailing "*", e.g. "kafka.consumer.lag*".
 *
 * When a system is onboarded, only this mapping needs to change.  The pattern
 * library, normaliser, and pattern worker remain unchanged.
 */
export interface SystemMapping {
  /** Stable identifier for this mapping, e.g. "aiven.kafka". */
  systemId: string;
  /**
   * Broad category used for grouping in dashboards and logs.
   * E.g. "streaming", "search", "database", "cache".
   */
  systemType: string;
  /**
   * Map from vendor metric name (or wildcard pattern) to operational primitive.
   * Exact matches take priority over wildcard matches.
   */
  metricMappings: Record<string, OperationalPrimitiveId>;
}

// ----------------------------------------------------------------
// Built-in mappings for Aiven-managed services
// These ship with the abstraction-engine and are used by default
// when the telemetry worker processes Aiven telemetry.
// ----------------------------------------------------------------

/**
 * Aiven Kafka metric mappings.
 * Sources: Aiven Kafka metrics API and Kafka JMX exporter conventions.
 */
export const AIVEN_KAFKA_MAPPING: SystemMapping = {
  systemId: "aiven.kafka",
  systemType: "streaming",
  metricMappings: {
    "consumer_lag":                           "BACKPRESSURE_ACCUMULATION",
    "consumer_lag_sum":                       "BACKPRESSURE_ACCUMULATION",
    "kafka_consumer_lag*":                    "BACKPRESSURE_ACCUMULATION",
    "messages_in_per_sec":                    "THROUGHPUT_COLLAPSE",
    "bytes_in_per_sec":                       "THROUGHPUT_COLLAPSE",
    "request_queue_size":                     "QUEUE_GROWTH",
    "produce_request_purgatory_size":         "QUEUE_GROWTH",
    "broker_cpu_idle":                        "RESOURCE_PRESSURE",
    "cpu_usage":                              "RESOURCE_PRESSURE",
    "memory_usage":                           "MEMORY_PRESSURE",
    "heap_memory_used":                       "MEMORY_PRESSURE",
    "disk_usage":                             "IO_SATURATION",
    "network_io_wait":                        "IO_SATURATION",
    "under_replicated_partitions":            "REPLICATION_LAG",
    "offline_partitions_count":               "INDEX_INCONSISTENCY",
    "partition_count_skew":                   "LOAD_SKEW",
    "leader_count_skew":                      "LOAD_SKEW",
    "request_total_time_99th_percentile":     "TAIL_LATENCY_EXPANSION",
    "produce_request_latency_ms_99th":        "TAIL_LATENCY_EXPANSION",
    "produce_request_latency_ms_mean":        "RESPONSE_DEGRADATION",
    "fetch_request_latency_ms_mean":          "RESPONSE_DEGRADATION",
    "reassigning_partitions":                 "STRUCTURAL_REBALANCE",
    "active_controller_count":                "STRUCTURAL_REBALANCE",
    "total_produce_requests_per_sec":         "RETRY_AMPLIFICATION",
  },
};

/**
 * Aiven OpenSearch metric mappings.
 */
export const AIVEN_OPENSEARCH_MAPPING: SystemMapping = {
  systemId: "aiven.opensearch",
  systemType: "search",
  metricMappings: {
    "search_query_latency_ms_99th":           "TAIL_LATENCY_EXPANSION",
    "search_query_latency_ms_mean":           "RESPONSE_DEGRADATION",
    "indexing_latency_ms_mean":               "RESPONSE_DEGRADATION",
    "jvm_heap_used_percent":                  "MEMORY_PRESSURE",
    "jvm_gc_time":                            "MEMORY_PRESSURE",
    "cpu_usage":                              "RESOURCE_PRESSURE",
    "disk_usage":                             "IO_SATURATION",
    "merge_current":                          "IO_SATURATION",
    "unassigned_shards":                      "INDEX_INCONSISTENCY",
    "initializing_shards":                    "STRUCTURAL_REBALANCE",
    "relocating_shards":                      "STRUCTURAL_REBALANCE",
    "index_shard_imbalance":                  "LOAD_SKEW",
    "search_rejected_count":                  "BACKPRESSURE_ACCUMULATION",
    "indexing_rejected_count":                "BACKPRESSURE_ACCUMULATION",
    "search_active_count":                    "QUEUE_GROWTH",
    "indexing_active_count":                  "QUEUE_GROWTH",
    "cluster_status":                         "CASCADING_FAILURE",
  },
};

/**
 * Aiven PostgreSQL metric mappings.
 */
export const AIVEN_POSTGRES_MAPPING: SystemMapping = {
  systemId: "aiven.postgres",
  systemType: "database",
  metricMappings: {
    "pg_stat_bgwriter_buffers_backend":       "IO_SATURATION",
    "pg_stat_bgwriter_checkpoint_write_time": "IO_SATURATION",
    "pg_replication_lag":                     "REPLICATION_LAG",
    "pg_replication_slot_lag":                "REPLICATION_LAG",
    "pg_locks_count":                         "RESOURCE_PRESSURE",
    "pg_active_queries":                      "QUEUE_GROWTH",
    "pg_waiting_queries":                     "BACKPRESSURE_ACCUMULATION",
    "pg_slow_queries":                        "TAIL_LATENCY_EXPANSION",
    "pg_heap_bloat":                          "RESOURCE_PRESSURE",
    "connection_count":                       "CONNECTION_EXHAUSTION",
    "connection_pool_usage":                  "CONNECTION_EXHAUSTION",
    "cpu_usage":                              "RESOURCE_PRESSURE",
    "disk_usage":                             "IO_SATURATION",
    "wal_size":                               "IO_SATURATION",
  },
};

/**
 * Aiven ClickHouse metric mappings.
 */
export const AIVEN_CLICKHOUSE_MAPPING: SystemMapping = {
  systemId: "aiven.clickhouse",
  systemType: "analytics",
  metricMappings: {
    "query_duration_ms_99th":                 "TAIL_LATENCY_EXPANSION",
    "query_duration_ms_mean":                 "RESPONSE_DEGRADATION",
    "parts_to_merge":                         "IO_SATURATION",
    "background_pool_task":                   "QUEUE_GROWTH",
    "memory_usage":                           "MEMORY_PRESSURE",
    "cpu_usage":                              "RESOURCE_PRESSURE",
    "disk_usage":                             "IO_SATURATION",
    "insert_blocks_per_second":               "THROUGHPUT_COLLAPSE",
    "failed_queries_per_second":              "CASCADING_FAILURE",
  },
};

// ----------------------------------------------------------------
// Built-in mappings for substrate-native services
// These cover the workers, API, and orchestrator that emit OTLP
// metrics via the internal collector → telemetry.metrics.otlp.
//
// Metric names follow the OTel semantic conventions used in
// packages/telemetry-otel/src/metrics.ts.
// ----------------------------------------------------------------

/**
 * Ingestion worker: embeddings and OpenSearch write latency.
 * High write latency or embedding stalls signal cognitive slowdown.
 */
export const SUBSTRATE_INGESTION_MAPPING: SystemMapping = {
  systemId: "substrate.ingestion-worker",
  systemType: "cognitive-ingestion",
  metricMappings: {
    "worker.message.duration_ms":              "RESPONSE_DEGRADATION",
    "worker.errors":                           "CASCADING_FAILURE",
    "worker.messages.processed":               "THROUGHPUT_COLLAPSE",
    "ingestion.embedding.duration_ms":         "RESPONSE_DEGRADATION",
    "ingestion.opensearch.write_duration_ms":  "IO_SATURATION",
    "ingestion.importance_score":              "COMPOSITE",
  },
};

/**
 * Orchestrator: CognitiveLoop turn latency and agent processing.
 * High turn latency or cascading errors signal cognitive overload.
 */
export const SUBSTRATE_ORCHESTRATOR_MAPPING: SystemMapping = {
  systemId: "substrate.orchestrator",
  systemType: "cognitive-orchestration",
  metricMappings: {
    "worker.message.duration_ms":              "TAIL_LATENCY_EXPANSION",
    "worker.errors":                           "CASCADING_FAILURE",
    "worker.messages.processed":               "THROUGHPUT_COLLAPSE",
  },
};

/**
 * API: request latency, error rate.
 */
export const SUBSTRATE_API_MAPPING: SystemMapping = {
  systemId: "substrate.api-bff",
  systemType: "cognitive-api",
  metricMappings: {
    "http.server.request.duration":            "RESPONSE_DEGRADATION",
    "http.server.active_requests":             "QUEUE_GROWTH",
    "http.server.response.body.size":          "IO_SATURATION",
    "worker.errors":                           "CASCADING_FAILURE",
  },
};

/**
 * Pattern worker: sliding window depth and match scores.
 * Growing window without matches signals detection stall.
 */
export const SUBSTRATE_PATTERN_MAPPING: SystemMapping = {
  systemId: "substrate.pattern-worker",
  systemType: "cognitive-pattern",
  metricMappings: {
    "worker.message.duration_ms":              "RESPONSE_DEGRADATION",
    "worker.errors":                           "CASCADING_FAILURE",
    "pattern.window_size":                     "BACKPRESSURE_ACCUMULATION",
    "pattern.matches":                         "THROUGHPUT_COLLAPSE",
    "pattern.match_score":                     "COMPOSITE",
  },
};

/**
 * Reinforcement worker: reward signal distribution and outcome tracking.
 */
export const SUBSTRATE_REINFORCEMENT_MAPPING: SystemMapping = {
  systemId: "substrate.reinforcement-worker",
  systemType: "cognitive-reinforcement",
  metricMappings: {
    "worker.message.duration_ms":              "RESPONSE_DEGRADATION",
    "worker.errors":                           "CASCADING_FAILURE",
    "reinforcement.recommendations_tracked":   "THROUGHPUT_COLLAPSE",
    "reinforcement.outcomes_recorded":         "THROUGHPUT_COLLAPSE",
    "reinforcement.reward_score":              "COMPOSITE",
  },
};

/**
 * Consolidation worker: semantic memory merge latency and source event count.
 */
export const SUBSTRATE_CONSOLIDATION_MAPPING: SystemMapping = {
  systemId: "substrate.consolidation-worker",
  systemType: "cognitive-consolidation",
  metricMappings: {
    "worker.message.duration_ms":              "RESPONSE_DEGRADATION",
    "worker.errors":                           "CASCADING_FAILURE",
    "consolidation.source_events":             "QUEUE_GROWTH",
    "consolidation.duration_ms":              "TAIL_LATENCY_EXPANSION",
  },
};

/**
 * Telemetry worker: ClickHouse write latency and batch size.
 */
export const SUBSTRATE_TELEMETRY_MAPPING: SystemMapping = {
  systemId: "substrate.telemetry-worker",
  systemType: "cognitive-telemetry",
  metricMappings: {
    "worker.message.duration_ms":              "RESPONSE_DEGRADATION",
    "worker.errors":                           "CASCADING_FAILURE",
    "telemetry.batch_size":                    "QUEUE_GROWTH",
    "telemetry.clickhouse.write_duration_ms":  "IO_SATURATION",
    "telemetry.primitive_events_emitted":      "THROUGHPUT_COLLAPSE",
  },
};

/** All built-in mappings: Aiven services + substrate-native workers. */
export const BUILTIN_MAPPINGS: ReadonlyMap<string, SystemMapping> = new Map([
  [AIVEN_KAFKA_MAPPING.systemId, AIVEN_KAFKA_MAPPING],
  [AIVEN_OPENSEARCH_MAPPING.systemId, AIVEN_OPENSEARCH_MAPPING],
  [AIVEN_POSTGRES_MAPPING.systemId, AIVEN_POSTGRES_MAPPING],
  [AIVEN_CLICKHOUSE_MAPPING.systemId, AIVEN_CLICKHOUSE_MAPPING],
  [SUBSTRATE_INGESTION_MAPPING.systemId, SUBSTRATE_INGESTION_MAPPING],
  [SUBSTRATE_ORCHESTRATOR_MAPPING.systemId, SUBSTRATE_ORCHESTRATOR_MAPPING],
  [SUBSTRATE_API_MAPPING.systemId, SUBSTRATE_API_MAPPING],
  [SUBSTRATE_PATTERN_MAPPING.systemId, SUBSTRATE_PATTERN_MAPPING],
  [SUBSTRATE_REINFORCEMENT_MAPPING.systemId, SUBSTRATE_REINFORCEMENT_MAPPING],
  [SUBSTRATE_CONSOLIDATION_MAPPING.systemId, SUBSTRATE_CONSOLIDATION_MAPPING],
  [SUBSTRATE_TELEMETRY_MAPPING.systemId, SUBSTRATE_TELEMETRY_MAPPING],
]);
