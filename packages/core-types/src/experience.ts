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

/**
 * A single block in an MCP-compatible content array.
 * Only `text` blocks are common for tool results; `image` and `resource_link`
 * are included for full spec coverage.
 */
export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name?: string;
      readonly description?: string;
      readonly mimeType?: string;
    };

/** The observed outcome of the action. */
export interface EventResult {
  /**
   * Flat text output. For MCP-sourced results this is the concatenation of
   * all `text` content blocks — kept for internal consumers that expect a
   * single string. Prefer `content` when the full structured response matters.
   */
  readonly output: string;
  /** Convenience inverse of `isError`. True when the tool call succeeded. */
  readonly success: boolean;
  readonly latencyMs?: number;
  readonly errorCode?: string;
  /**
   * MCP-compatible structured content array. Present when the result came
   * from an MCP tool call or a plugin that returns rich content. When absent,
   * callers should fall back to `output`.
   */
  readonly content?: ReadonlyArray<ContentBlock>;
  /**
   * MCP wire-format error flag. True when the tool itself returned an error
   * result (as opposed to a transport/invocation failure). Inverse of `success`.
   */
  readonly isError?: boolean;
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
