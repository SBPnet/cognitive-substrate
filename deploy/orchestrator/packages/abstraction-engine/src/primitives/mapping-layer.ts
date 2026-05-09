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

/** All built-in Aiven service mappings, keyed by systemId. */
export const BUILTIN_MAPPINGS: ReadonlyMap<string, SystemMapping> = new Map([
  [AIVEN_KAFKA_MAPPING.systemId, AIVEN_KAFKA_MAPPING],
  [AIVEN_OPENSEARCH_MAPPING.systemId, AIVEN_OPENSEARCH_MAPPING],
  [AIVEN_POSTGRES_MAPPING.systemId, AIVEN_POSTGRES_MAPPING],
  [AIVEN_CLICKHOUSE_MAPPING.systemId, AIVEN_CLICKHOUSE_MAPPING],
]);
