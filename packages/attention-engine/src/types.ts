/**
 * Attention-engine type surface.
 *
 * The attention engine routes a stream of `AttentionCandidate` items into
 * three lanes (interrupt, primary, background) under a fixed budget. It is
 * the runtime analogue of working-memory selection: every cognitive cycle
 * passes through the engine so that the executor receives a small ranked
 * focus set rather than the full firehose of events, memories, and goals.
 */

import type { ExperienceEvent, Goal, MemoryReference, PolicyState } from "@cognitive-substrate/core-types";

/**
 * Lane assigned to an attention candidate.
 *
 *   - `interrupt`: salience exceeds the interrupt threshold and overrides
 *     current focus.
 *   - `primary`: enters the working set for the next cognitive cycle.
 *   - `background`: tracked but not actively reasoned over.
 */
export type AttentionLane = "interrupt" | "primary" | "background";

/**
 * One item competing for working-memory bandwidth. Candidates can come from
 * incoming experience, retrieved memories, active goals, or system events.
 * All scoring fields are normalised to `[0, 1]`.
 */
export interface AttentionCandidate {
  readonly candidateId: string;
  readonly summary: string;
  readonly source: "experience" | "memory" | "goal" | "system";
  /** Baseline importance contributed to the salience score. */
  readonly importance: number;
  /** Distance from prior memory clusters; raises salience under exploration policy. */
  readonly novelty?: number;
  /** Time-criticality of the candidate. */
  readonly urgency?: number;
  /** Topical fit with the current cycle's input. */
  readonly relevance?: number;
  /** Estimated downside if the candidate is acted on incorrectly. */
  readonly risk?: number;
  /** Wall-clock origin time; older candidates decay automatically. */
  readonly timestamp?: string;
}

/**
 * Side-channel context passed to the engine. None of the fields are
 * required; supplying them refines the salience computation by exposing
 * goals, retrieved memory, and the current policy vector.
 */
export interface AttentionContext {
  readonly event?: ExperienceEvent;
  readonly memories?: ReadonlyArray<MemoryReference>;
  readonly goals?: ReadonlyArray<Goal>;
  readonly policy?: Partial<PolicyState>;
  /** Candidate currently holding focus; receives a focus-persistence boost. */
  readonly activeFocusId?: string;
}

/**
 * Bounds on the attention budget. Tuning these parameters trades reaction
 * speed against consistency: higher `focusPersistence` keeps attention on
 * the current target longer, higher `decayRate` discards stale candidates
 * faster.
 */
export interface AttentionBudget {
  readonly maxPrimaryItems: number;
  readonly maxBackgroundItems: number;
  /** Salience above this value forces an interrupt. */
  readonly interruptThreshold: number;
  /** Bonus applied to the candidate matching `activeFocusId`. */
  readonly focusPersistence: number;
  /** Per-hour decay applied to candidates with a `timestamp`. */
  readonly decayRate: number;
}

/** Routing assignment for a single candidate. */
export interface AttentionAllocation {
  readonly candidateId: string;
  readonly lane: AttentionLane;
  readonly salience: number;
  /** 1-indexed rank within the input set, by descending salience. */
  readonly rank: number;
  readonly summary: string;
}

/** Output of one routing pass. */
export interface AttentionRoutingResult {
  readonly primary: ReadonlyArray<AttentionAllocation>;
  readonly background: ReadonlyArray<AttentionAllocation>;
  readonly interrupts: ReadonlyArray<AttentionAllocation>;
  readonly dropped: ReadonlyArray<AttentionAllocation>;
  /** Suggested focus for the next cycle. Interrupts win, then primary[0]. */
  readonly nextFocusId?: string;
}
