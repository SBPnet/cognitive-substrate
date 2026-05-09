/**
 * Interaction-layer types bridging the cognitive pipeline back to the end user.
 * The orchestrator emits an InteractionResponseEvent after each CognitiveLoop
 * cycle, carrying the selected proposal and session context that the API/BFF
 * surfaces to the front end.
 */

import type { AgentResult, CognitiveSession } from "./agent.js";
import type { MemoryReference } from "./memory.js";
import type { PolicyState } from "./policy.js";

/** Status of the cognitive loop processing cycle. */
export type InteractionStatus =
  | "processing"
  | "complete"
  | "partial"
  | "failed";

/**
 * Published to `interaction.response` by the orchestrator after processing
 * each ExperienceEvent through the CognitiveLoop. The BFF consumes this
 * and routes it to the correct SSE connection by sessionId.
 */
export interface InteractionResponseEvent {
  /** Mirrors the source ExperienceEvent's eventId. */
  readonly eventId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly timestamp: string;
  readonly status: InteractionStatus;

  /** The winning agent proposal — the user-visible response text. */
  readonly responseText: string;

  /** Confidence from the arbitration layer (0–1). */
  readonly confidence: number;

  /** Risk score from the arbitration layer (0–1). */
  readonly riskScore: number;

  /** Memories consulted during the loop. */
  readonly retrievedMemories: ReadonlyArray<MemoryReference>;

  /** Policy snapshot active during this interaction. */
  readonly policySnapshot: PolicyState;

  /** Full agent result for transparency. */
  readonly agentResult: AgentResult;

  /** Session metadata. */
  readonly session: CognitiveSession;

  /** Error description if status is "failed". */
  readonly errorMessage?: string;
}

/** A lightweight event sent on SSE streams representing pipeline milestones. */
export interface PipelineStatusEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly stage:
    | "received"
    | "embedding"
    | "indexed"
    | "reasoning"
    | "arbitrating"
    | "complete"
    | "failed";
  readonly detail?: string;
}
