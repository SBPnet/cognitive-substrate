/**
 * Cognitive architecture semantic conventions for OpenTelemetry.
 *
 * These attribute keys extend the standard OTel semantic conventions with
 * domain-specific attributes that make cognitive traces interpretable without
 * manual log parsing.
 *
 * All keys follow the namespace `cog.*` to avoid collision with OTel stable
 * conventions and vendor namespaces.
 */

/** Agent-layer attributes. */
export const CogAttributes = {
  /** The type of the agent producing this span. */
  AGENT_TYPE: "cog.agent.type",

  /** Number of agents participating in the current arbitration round. */
  AGENT_COUNT: "cog.agent.count",

  /** Unique ID of the experience event being processed. */
  EVENT_ID: "cog.event.id",

  /** Classification of the experience event. */
  EVENT_TYPE: "cog.event.type",

  /** Dimensionality of the embedding vector attached to this event. */
  EMBEDDING_DIM: "cog.embedding.dim",

  /** Computed importance score for the experience or memory. */
  IMPORTANCE_SCORE: "cog.importance.score",

  /** Reward signal value (positive or negative). */
  REWARD_DELTA: "cog.reward.delta",

  /** ID of the memory retrieved or written. */
  MEMORY_ID: "cog.memory.id",

  /** OpenSearch index targeted by this operation. */
  MEMORY_INDEX: "cog.memory.index",

  /** Number of memories retrieved in this pass. */
  MEMORY_RESULTS: "cog.memory.results",

  /** Retrieval precision score (fraction of retrieved memories used). */
  RETRIEVAL_PRECISION: "cog.retrieval.precision",

  /** Semantic similarity score of the top retrieved memory. */
  SIMILARITY_SCORE: "cog.similarity.score",

  /** Current policy version string. */
  POLICY_VERSION: "cog.policy.version",

  /** Policy retrieval bias value at time of span creation. */
  POLICY_RETRIEVAL_BIAS: "cog.policy.retrieval_bias",

  /** Policy exploration factor value at time of span creation. */
  POLICY_EXPLORATION_FACTOR: "cog.policy.exploration_factor",

  /** ID of the active goal. */
  GOAL_ID: "cog.goal.id",

  /** Progress delta applied to the goal in this span. */
  GOAL_PROGRESS_DELTA: "cog.goal.progress_delta",

  /** World-model prediction confidence score. */
  WORLDMODEL_CONFIDENCE: "cog.worldmodel.confidence",

  /** World-model risk score for the proposed action. */
  WORLDMODEL_RISK: "cog.worldmodel.risk",

  /** Prediction accuracy relative to observed outcome (retrospective). */
  WORLDMODEL_ACCURACY: "cog.worldmodel.accuracy",

  /** Number of memory clusters produced in a consolidation cycle. */
  CONSOLIDATION_CLUSTER_COUNT: "cog.consolidation.cluster_count",

  /** Average reinforcement score across consolidated memories. */
  CONSOLIDATION_AVG_REINFORCEMENT: "cog.consolidation.avg_reinforcement",

  /** Duration of the consolidation batch in milliseconds. */
  CONSOLIDATION_DURATION_MS: "cog.consolidation.duration_ms",

  /** Number of memories decayed (priority reduced) in this cycle. */
  DECAY_EVENT_COUNT: "cog.decay.event_count",

  /** Confidence score of the winning arbitration decision. */
  DECISION_CONFIDENCE: "cog.decision.confidence",

  /** Whether a hallucination was detected in this span. */
  HALLUCINATION_DETECTED: "cog.hallucination.detected",

  /** Self-modification mutation type. */
  MUTATION_TYPE: "cog.mutation.type",

  /** Self-modification stability risk score. */
  MUTATION_STABILITY_RISK: "cog.mutation.stability_risk",

  /** Identity state curiosity value. */
  IDENTITY_CURIOSITY: "cog.identity.curiosity",

  /** Identity state caution value. */
  IDENTITY_CAUTION: "cog.identity.caution",

  /** Identity stability score. */
  IDENTITY_STABILITY: "cog.identity.stability",

  /** Cognitive session ID. */
  SESSION_ID: "cog.session.id",
} as const;

export type CogAttributeKey = (typeof CogAttributes)[keyof typeof CogAttributes];
