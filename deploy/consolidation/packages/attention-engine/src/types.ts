import type { ExperienceEvent, Goal, MemoryReference, PolicyState } from "@cognitive-substrate/core-types";

export type AttentionLane = "interrupt" | "primary" | "background";

export interface AttentionCandidate {
  readonly candidateId: string;
  readonly summary: string;
  readonly source: "experience" | "memory" | "goal" | "system";
  readonly importance: number;
  readonly novelty?: number;
  readonly urgency?: number;
  readonly relevance?: number;
  readonly risk?: number;
  readonly timestamp?: string;
}

export interface AttentionContext {
  readonly event?: ExperienceEvent;
  readonly memories?: ReadonlyArray<MemoryReference>;
  readonly goals?: ReadonlyArray<Goal>;
  readonly policy?: Partial<PolicyState>;
  readonly activeFocusId?: string;
}

export interface AttentionBudget {
  readonly maxPrimaryItems: number;
  readonly maxBackgroundItems: number;
  readonly interruptThreshold: number;
  readonly focusPersistence: number;
  readonly decayRate: number;
}

export interface AttentionAllocation {
  readonly candidateId: string;
  readonly lane: AttentionLane;
  readonly salience: number;
  readonly rank: number;
  readonly summary: string;
}

export interface AttentionRoutingResult {
  readonly primary: ReadonlyArray<AttentionAllocation>;
  readonly background: ReadonlyArray<AttentionAllocation>;
  readonly interrupts: ReadonlyArray<AttentionAllocation>;
  readonly dropped: ReadonlyArray<AttentionAllocation>;
  readonly nextFocusId?: string;
}
