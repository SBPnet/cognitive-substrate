/**
 * Core types for experience events: the atomic unit of cognition in this
 * architecture. Every perception, action, and observed outcome is captured
 * as an ExperienceEvent before being routed into the memory pipeline.
 */

/** Classification of the event origin within the cognitive loop. */
export type EventType =
  | "user_input"
  | "tool_result"
  | "system_event"
  | "agent_action"
  | "environmental_observation"
  | "consolidation_output";

/** Slim context block attached to every event. */
export interface EventContext {
  readonly sessionId: string;
  readonly userId?: string;
  readonly goalId?: string;
  readonly policyVersion?: string;
  readonly agentId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

/** Raw and embedded representations of the event content. */
export interface EventInput {
  readonly text: string;
  readonly embedding: ReadonlyArray<number>;
  readonly structured?: Readonly<Record<string, unknown>>;
}

/** Snapshot of the agent's internal state at event time. */
export interface InternalState {
  readonly workingMemorySnapshot?: string;
  readonly confidence: number;
  readonly activePlan?: string;
  readonly emotionalVector?: Readonly<Record<string, number>>;
}

/** The action performed (if any) in response to the input. */
export interface EventAction {
  readonly tool?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly reasoning?: string;
}

/** The observed outcome of the action. */
export interface EventResult {
  readonly output: string;
  readonly success: boolean;
  readonly latencyMs?: number;
  readonly errorCode?: string;
}

/** Evaluation metadata used by the reinforcement engine. */
export interface EventEvaluation {
  readonly rewardScore: number;
  readonly userFeedback?: "positive" | "negative" | "neutral";
  readonly selfAssessedQuality: number;
  readonly hallucinated?: boolean;
}

/**
 * The atomic unit of cognitive experience. Every event is written to the
 * object-storage truth layer and indexed in OpenSearch.
 */
export interface ExperienceEvent {
  readonly eventId: string;
  readonly timestamp: string;
  readonly type: EventType;
  readonly context: EventContext;
  readonly input: EventInput;
  readonly internalState?: InternalState;
  readonly action?: EventAction;
  readonly result?: EventResult;
  readonly evaluation?: EventEvaluation;
  /** Key of the full payload in object storage. */
  readonly objectStorageKey?: string;
  readonly importanceScore: number;
  readonly tags: ReadonlyArray<string>;
}
