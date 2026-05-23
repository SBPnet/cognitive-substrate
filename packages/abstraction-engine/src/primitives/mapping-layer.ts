import type { OperationalPrimitiveId } from "./taxonomy.js";

/**
 * System mapping DSL -- the adapter definition that binds a specific
 * infrastructure environment to the system-agnostic primitive vocabulary.
 *
 * Rules for a valid mapping:
 *   1. metricMappings keys must be vendor metric names (not primitive names).
 *   2. Values must be OperationalPrimitiveId constants.
 *   3. No system names, cluster IDs, or topology references may appear in the
 *      OperationalPrimitiveId values -- they are already system-agnostic.
 *   4. Wildcard patterns use a trailing "*", e.g. "kafka.consumer.lag*".
 *
 * When a system is onboarded, only this mapping needs to change. The pattern
 * library, normaliser, and pattern worker remain unchanged.
 *
 * Provider-specific mappings (e.g. Aiven) live in their own integration
 * packages and are registered via TelemetryPipelineConfig.extraMappings.
 * The built-in set covers generic OTel semantic convention metric names and
 * substrate-native workers only.
 */
export interface SystemMapping {
  /** Stable identifier for this mapping, e.g. "kafka" or "aiven.kafka". */
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
// Generic mappings using OTel semantic convention metric names.
// These match any Kafka, OpenSearch, ClickHouse, or PostgreSQL
// deployment that exports standard OTel metrics -- self-hosted,
// cloud-managed, or otherwise.
//
// Provider-specific metric names (e.g. Aiven's Prometheus exporter
// names) require a custom mapping registered via extraMappings in
// TelemetryPipelineConfig. The cognitive-substrate-aiven package
// provides those mappings for Aiven-managed services.
// ----------------------------------------------------------------

/**
 * Generic Kafka mapping -- OTel semantic convention and JMX exporter names.
 * Keyed as "kafka" to match the bare serviceType from any Kafka deployment.
 */
export const GENERIC_KAFKA_MAPPING: SystemMapping = {
  systemId: "kafka",
  systemType: "streaming",
  metricMappings: {
    "kafka.consumer.group.lag":                        "BACKPRESSURE_ACCUMULATION",
    "kafka.consumer.group.lag.sum":                    "BACKPRESSURE_ACCUMULATION",
    "kafka.consumer_lag*":                             "BACKPRESSURE_ACCUMULATION",
    "kafka.producer.record.send.rate":                 "THROUGHPUT_COLLAPSE",
    "kafka.network.io.bytes.rate":                     "THROUGHPUT_COLLAPSE",
    "kafka.request.queue.size":                        "QUEUE_GROWTH",
    "kafka.partition.under.replicated":                "REPLICATION_LAG",
    "kafka.partition.offline":                         "INDEX_INCONSISTENCY",
    "kafka.leader.election.rate":                      "STRUCTURAL_REBALANCE",
    "kafka.request.total.time.99p":                    "TAIL_LATENCY_EXPANSION",
    "kafka.request.produce.time.mean":                 "RESPONSE_DEGRADATION",
    "kafka.request.fetch.time.mean":                   "RESPONSE_DEGRADATION",
    "process.cpu.time":                                "RESOURCE_PRESSURE",
    "jvm.memory.used":                                 "MEMORY_PRESSURE",
    "jvm.gc.duration":                                 "MEMORY_PRESSURE",
  },
};

/**
 * Generic OpenSearch / Elasticsearch mapping -- OTel semantic convention names.
 * Keyed as "opensearch" to match any OpenSearch or Elasticsearch deployment.
 */
export const GENERIC_OPENSEARCH_MAPPING: SystemMapping = {
  systemId: "opensearch",
  systemType: "search",
  metricMappings: {
    "elasticsearch.index.operations.time":             "RESPONSE_DEGRADATION",
    "elasticsearch.index.operations.completed":        "THROUGHPUT_COLLAPSE",
    "elasticsearch.indexing.pressure.memory":          "MEMORY_PRESSURE",
    "jvm.memory.heap.used":                            "MEMORY_PRESSURE",
    "jvm.gc.collections.elapsed":                      "MEMORY_PRESSURE",
    "elasticsearch.node.cache.evictions":              "MEMORY_PRESSURE",
    "elasticsearch.cluster.shards":                    "STRUCTURAL_REBALANCE",
    "elasticsearch.cluster.pending_tasks":             "QUEUE_GROWTH",
    "elasticsearch.node.thread_pool.queue":            "QUEUE_GROWTH",
    "elasticsearch.node.thread_pool.rejected":         "BACKPRESSURE_ACCUMULATION",
    "elasticsearch.node.documents":                    "IO_SATURATION",
    "process.cpu.time":                                "RESOURCE_PRESSURE",
  },
};

/**
 * Generic ClickHouse mapping -- system.* and OTel-compatible metric names.
 * Keyed as "clickhouse" to match any ClickHouse deployment.
 */
export const GENERIC_CLICKHOUSE_MAPPING: SystemMapping = {
  systemId: "clickhouse",
  systemType: "analytics",
  metricMappings: {
    "ClickHouse.ProfileEvent.Query":                            "THROUGHPUT_COLLAPSE",
    "ClickHouse.ProfileEvent.FailedQuery":                      "CASCADING_FAILURE",
    "ClickHouse.ProfileEvent.InsertedRows":                     "THROUGHPUT_COLLAPSE",
    "ClickHouse.ProfileEvent.MergesTimeMilliseconds":           "IO_SATURATION",
    "ClickHouse.ProfileEvent.BackgroundMergesAndMutationsPoolTask": "QUEUE_GROWTH",
    "ClickHouse.Metric.MemoryTracking":                         "MEMORY_PRESSURE",
    "ClickHouse.Metric.ReplicatedChecks":                       "STRUCTURAL_REBALANCE",
    "ClickHouse.Metric.Query":                                  "QUEUE_GROWTH",
    "process.cpu.time":                                         "RESOURCE_PRESSURE",
  },
};

/**
 * Generic PostgreSQL mapping -- postgres_exporter and OTel convention names.
 * Keyed as "postgres" to match any PostgreSQL deployment.
 */
export const GENERIC_POSTGRES_MAPPING: SystemMapping = {
  systemId: "postgres",
  systemType: "database",
  metricMappings: {
    "postgresql.bgwriter.buffers.writes":               "IO_SATURATION",
    "postgresql.bgwriter.checkpoint.count":             "IO_SATURATION",
    "postgresql.replication.data_delay":                "REPLICATION_LAG",
    "postgresql.locks":                                 "RESOURCE_PRESSURE",
    "postgresql.operations":                            "QUEUE_GROWTH",
    "postgresql.rows":                                  "BACKPRESSURE_ACCUMULATION",
    "postgresql.deadlocks":                             "TAIL_LATENCY_EXPANSION",
    "postgresql.table.bloat":                           "RESOURCE_PRESSURE",
    "postgresql.connection.count":                      "CONNECTION_EXHAUSTION",
    "postgresql.connection.max":                        "CONNECTION_EXHAUSTION",
    "process.cpu.time":                                 "RESOURCE_PRESSURE",
    "postgresql.wal.age":                               "IO_SATURATION",
  },
};

// ----------------------------------------------------------------
// Built-in mappings for substrate-native services
// These cover the workers, API, and orchestrator that emit OTLP
// metrics via the internal collector -> telemetry.metrics.otlp.
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
    "consolidation.duration_ms":               "TAIL_LATENCY_EXPANSION",
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

/**
 * Built-in mappings: generic service types + substrate-native workers.
 *
 * Provider-specific mappings (e.g. "aiven.kafka") are NOT included here.
 * Register them via TelemetryPipelineConfig.extraMappings in whatever
 * integration package owns that provider.
 */
export const BUILTIN_MAPPINGS: ReadonlyMap<string, SystemMapping> = new Map([
  [GENERIC_KAFKA_MAPPING.systemId,        GENERIC_KAFKA_MAPPING],
  [GENERIC_OPENSEARCH_MAPPING.systemId,   GENERIC_OPENSEARCH_MAPPING],
  [GENERIC_CLICKHOUSE_MAPPING.systemId,   GENERIC_CLICKHOUSE_MAPPING],
  [GENERIC_POSTGRES_MAPPING.systemId,     GENERIC_POSTGRES_MAPPING],
  [SUBSTRATE_INGESTION_MAPPING.systemId,      SUBSTRATE_INGESTION_MAPPING],
  [SUBSTRATE_ORCHESTRATOR_MAPPING.systemId,   SUBSTRATE_ORCHESTRATOR_MAPPING],
  [SUBSTRATE_API_MAPPING.systemId,            SUBSTRATE_API_MAPPING],
  [SUBSTRATE_PATTERN_MAPPING.systemId,        SUBSTRATE_PATTERN_MAPPING],
  [SUBSTRATE_REINFORCEMENT_MAPPING.systemId,  SUBSTRATE_REINFORCEMENT_MAPPING],
  [SUBSTRATE_CONSOLIDATION_MAPPING.systemId,  SUBSTRATE_CONSOLIDATION_MAPPING],
  [SUBSTRATE_TELEMETRY_MAPPING.systemId,      SUBSTRATE_TELEMETRY_MAPPING],
]);
