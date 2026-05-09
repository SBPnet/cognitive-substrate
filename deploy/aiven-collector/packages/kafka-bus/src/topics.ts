/**
 * Canonical topic registry for the cognitive signal bus.
 * All Kafka topics used by the cognitive-substrate architecture are declared here.
 * Producers and consumers import topic names from this module rather than
 * using raw string literals, preventing drift between services.
 *
 * Topic namespaces:
 *   experience.*  : user-facing cognitive interaction pipeline (standard Kafka)
 *   memory.*      : memory lifecycle events (standard Kafka)
 *   agent.*       : multi-agent reasoning dispatch (standard Kafka)
 *   worldmodel.*  : world-model simulation (standard Kafka)
 *   policy.*      : policy engine outputs (standard Kafka)
 *   goal.*        : goal system progress (standard Kafka)
 *   consolidation.*: offline consolidation triggers (standard Kafka)
 *   identity.*    : identity formation events (standard Kafka)
 *   selfmod.*     : self-modification proposals (standard Kafka)
 *   audit.*       : immutable audit mirror (standard Kafka)
 *   interaction.* : BFF response routing (standard Kafka)
 *   telemetry.*   : raw infrastructure telemetry ingestion (Diskless / KIP-1150)
 *   cognition.*   : processed operational intelligence output (Diskless / KIP-1150)
 */

export const Topics = {
  // ----------------------------------------------------------------
  // Cognitive interaction pipeline: standard Kafka topics
  // ----------------------------------------------------------------

  /** Raw experience events as they arrive from any input source. */
  EXPERIENCE_RAW: "experience.raw",

  /** Enriched events: embedding attached, importance scored, tags assigned. */
  EXPERIENCE_ENRICHED: "experience.enriched",

  /** Confirmation that an event has been indexed in OpenSearch + object storage. */
  MEMORY_INDEXED: "memory.indexed",

  /** Multi-agent reasoning task dispatch. */
  AGENT_REASONING_REQUEST: "agent.reasoning.request",

  /** Multi-agent reasoning proposals, including critic annotations. */
  AGENT_REASONING_RESPONSE: "agent.reasoning.response",

  /** World-model simulation outputs. */
  WORLDMODEL_PREDICTION: "worldmodel.prediction",

  /** Reward scoring inputs for the policy engine. */
  POLICY_EVALUATION: "policy.evaluation",

  /** Updated policy state broadcast after each reinforcement cycle. */
  POLICY_UPDATED: "policy.updated",

  /** Goal progress updates from the goal system. */
  GOAL_PROGRESS: "goal.progress",

  /** Consolidation batch requests (the "sleep cycle" trigger). */
  CONSOLIDATION_REQUEST: "consolidation.request",

  /** Consolidated semantic memories written back to OpenSearch. */
  MEMORY_SEMANTIC_UPDATED: "memory.semantic.updated",

  /** Identity drift updates from the identity formation engine. */
  IDENTITY_UPDATED: "identity.updated",

  /** Self-modification proposals from the meta-cognition engine. */
  SELFMOD_PROPOSED: "selfmod.proposed",

  /** Validated (approved or rejected) self-modification decisions. */
  SELFMOD_VALIDATED: "selfmod.validated",

  /** Immutable audit stream: every significant cognitive event is mirrored here. */
  AUDIT_EVENTS: "audit.events",

  /**
   * Orchestrator response events routed back to the API/BFF per session.
   * Each message carries the selected agent proposal and cognitive context
   * for delivery to the end-user workbench via SSE.
   */
  INTERACTION_RESPONSE: "interaction.response",

  // ----------------------------------------------------------------
  // Telemetry tier: Diskless topics (KIP-1150)
  // High-volume append-only streams backed by object storage.
  // Scrape intervals are 15 s+; broker latency of 500 ms–5 s is acceptable.
  // ----------------------------------------------------------------

  /** Raw metric data points ingested from Aiven service integrations and OTEL collectors. */
  TELEMETRY_METRICS_RAW: "telemetry.metrics.raw",

  /** Raw structured log records from monitored services. */
  TELEMETRY_LOGS_RAW: "telemetry.logs.raw",

  /** Raw infrastructure metadata snapshots and project events from managed services. */
  TELEMETRY_METADATA_RAW: "telemetry.metadata.raw",

  /** Raw distributed trace spans from OTEL exporters. */
  TELEMETRY_TRACES_RAW: "telemetry.traces.raw",

  /**
   * Normalised telemetry events: vendor-specific metric names resolved to
   * system-agnostic operational primitives by the telemetry worker.
   */
  TELEMETRY_EVENTS_NORMALIZED: "telemetry.events.normalized",

  // ----------------------------------------------------------------
  // Cognition tier: Diskless topics (KIP-1150)
  // Processed operational intelligence; minutes-level latency acceptable.
  // ----------------------------------------------------------------

  /**
   * Detected operational primitive signals emitted by the telemetry worker.
   * Each event is system-agnostic (e.g. BACKPRESSURE_ACCUMULATION) and
   * carries intensity, trend, confidence, and correlated signal IDs.
   */
  COGNITION_PRIMITIVES: "cognition.primitives",

  /**
   * Matched operational patterns discovered by the pattern worker.
   * Contains the full pattern record including precursor signatures and
   * recommended interventions.
   */
  COGNITION_PATTERNS: "cognition.patterns",

  /**
   * Anomaly events emitted when pattern confidence exceeds the detection
   * threshold. Consumed by alert sinks, the Cognitive Observatory UI,
   * and the reinforcement worker.
   */
  COGNITION_ANOMALIES: "cognition.anomalies",

  /**
   * Operational recommendations generated by the pattern worker.
   * Consumed by alert sinks, dashboards, and the reinforcement worker
   * which tracks whether each recommendation improved system state.
   */
  COGNITION_RECOMMENDATIONS: "cognition.recommendations",
} as const;

export type TopicName = (typeof Topics)[keyof typeof Topics];

/** Mapping from topic name to its expected Kafka partition count and retention. */
export interface TopicConfig {
  readonly name: TopicName;
  readonly partitions: number;
  readonly retentionMs: number;
  readonly replicationFactor: number;
  /** When true the topic uses Diskless storage (KIP-1150 / remote_storage_enable). */
  readonly diskless?: boolean;
}

export const TOPIC_CONFIGS: ReadonlyArray<TopicConfig> = [
  // Cognitive interaction pipeline
  { name: Topics.EXPERIENCE_RAW, partitions: 12, retentionMs: 7 * 86_400_000, replicationFactor: 3 },
  { name: Topics.EXPERIENCE_ENRICHED, partitions: 12, retentionMs: 7 * 86_400_000, replicationFactor: 3 },
  { name: Topics.MEMORY_INDEXED, partitions: 6, retentionMs: 30 * 86_400_000, replicationFactor: 3 },
  { name: Topics.AGENT_REASONING_REQUEST, partitions: 12, retentionMs: 3 * 86_400_000, replicationFactor: 3 },
  { name: Topics.AGENT_REASONING_RESPONSE, partitions: 12, retentionMs: 3 * 86_400_000, replicationFactor: 3 },
  { name: Topics.WORLDMODEL_PREDICTION, partitions: 6, retentionMs: 30 * 86_400_000, replicationFactor: 3 },
  { name: Topics.POLICY_EVALUATION, partitions: 6, retentionMs: 7 * 86_400_000, replicationFactor: 3 },
  { name: Topics.POLICY_UPDATED, partitions: 3, retentionMs: 90 * 86_400_000, replicationFactor: 3 },
  { name: Topics.GOAL_PROGRESS, partitions: 3, retentionMs: 90 * 86_400_000, replicationFactor: 3 },
  { name: Topics.CONSOLIDATION_REQUEST, partitions: 6, retentionMs: 7 * 86_400_000, replicationFactor: 3 },
  { name: Topics.MEMORY_SEMANTIC_UPDATED, partitions: 6, retentionMs: 90 * 86_400_000, replicationFactor: 3 },
  { name: Topics.IDENTITY_UPDATED, partitions: 3, retentionMs: -1, replicationFactor: 3 },
  { name: Topics.SELFMOD_PROPOSED, partitions: 3, retentionMs: -1, replicationFactor: 3 },
  { name: Topics.SELFMOD_VALIDATED, partitions: 3, retentionMs: -1, replicationFactor: 3 },
  { name: Topics.AUDIT_EVENTS, partitions: 6, retentionMs: -1, replicationFactor: 3 },
  { name: Topics.INTERACTION_RESPONSE, partitions: 12, retentionMs: 24 * 60 * 60_000, replicationFactor: 3 },

  // Telemetry tier (Diskless)
  { name: Topics.TELEMETRY_METRICS_RAW, partitions: 24, retentionMs: 7 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.TELEMETRY_LOGS_RAW, partitions: 24, retentionMs: 7 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.TELEMETRY_METADATA_RAW, partitions: 6, retentionMs: 30 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.TELEMETRY_TRACES_RAW, partitions: 12, retentionMs: 3 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.TELEMETRY_EVENTS_NORMALIZED, partitions: 12, retentionMs: 14 * 86_400_000, replicationFactor: 3, diskless: true },

  // Cognition tier (Diskless)
  { name: Topics.COGNITION_PRIMITIVES, partitions: 12, retentionMs: 30 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.COGNITION_PATTERNS, partitions: 6, retentionMs: 90 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.COGNITION_ANOMALIES, partitions: 6, retentionMs: 90 * 86_400_000, replicationFactor: 3, diskless: true },
  { name: Topics.COGNITION_RECOMMENDATIONS, partitions: 6, retentionMs: 90 * 86_400_000, replicationFactor: 3, diskless: true },
];
