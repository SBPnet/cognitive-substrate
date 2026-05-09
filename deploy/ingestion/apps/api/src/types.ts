/**
 * API/BFF data transfer objects.
 * These are the shapes surfaced to the front end — a stable contract
 * that insulates the UI from internal domain type changes.
 */

import type { InteractionResponseEvent, MemoryReference, PolicyState } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
  readonly userId?: string;
  readonly initialGoal?: string;
}

export interface SessionDto {
  readonly sessionId: string;
  readonly userId?: string | undefined;
  readonly createdAt: string;
  readonly messageCount: number;
  readonly status: "active" | "idle";
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface SendMessageRequest {
  readonly text: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface SendMessageResponse {
  readonly eventId: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly status: "queued";
}

// ---------------------------------------------------------------------------
// Interaction responses (forwarded from Kafka)
// ---------------------------------------------------------------------------

export interface InteractionResponseDto {
  readonly eventId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly timestamp: string;
  readonly status: InteractionResponseEvent["status"];
  readonly responseText: string;
  readonly confidence: number;
  readonly riskScore: number;
  readonly errorMessage?: string | undefined;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export interface MemoryDto {
  readonly memoryId: string;
  readonly index: string;
  readonly summary: string;
  readonly importanceScore: number;
  readonly score: number;
  readonly tags?: ReadonlyArray<string> | undefined;
  readonly lastRetrieved?: string | undefined;
}

export interface MemoriesResponse {
  readonly memories: ReadonlyArray<MemoryDto>;
  readonly total: number;
}

export function memoryRefToDto(ref: MemoryReference): MemoryDto {
  const dto: MemoryDto = {
    memoryId: ref.memoryId,
    index: ref.index,
    summary: ref.summary,
    importanceScore: ref.importanceScore,
    score: ref.score,
  };
  if (ref.lastRetrieved !== undefined) {
    return { ...dto, lastRetrieved: ref.lastRetrieved };
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Trace / audit
// ---------------------------------------------------------------------------

export type TraceStage =
  | "received"
  | "embedding"
  | "indexed"
  | "reasoning"
  | "arbitrating"
  | "complete"
  | "failed";

export interface TraceEventDto {
  readonly eventId: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly stage: TraceStage;
  readonly detail?: string;
}

export interface AgentActivityDto {
  readonly traceId: string;
  readonly timestamp: string;
  readonly agentType: string;
  readonly inputSummary: string;
  readonly proposedAction: string;
  readonly confidence: number;
  readonly score: number;
  readonly selected: boolean;
  readonly critique?: string;
}

// ---------------------------------------------------------------------------
// Policy snapshot (subset surfaced to UI)
// ---------------------------------------------------------------------------

export type PolicySnapshotDto = Pick<
  PolicyState,
  | "version"
  | "timestamp"
  | "retrievalBias"
  | "riskTolerance"
  | "explorationFactor"
>;

// ---------------------------------------------------------------------------
// SSE envelope
// ---------------------------------------------------------------------------

export type SseEventType =
  | "interaction_response"
  | "trace"
  | "memory_update"
  | "policy_update"
  | "error"
  | "ping";

export interface SseEnvelope<T = unknown> {
  readonly type: SseEventType;
  readonly payload: T;
}
