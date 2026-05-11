/**
 * Temporal-engine type surface.
 *
 * The temporal engine ranks tasks by urgency, allocates a subjective-time
 * budget, and selects an active planning horizon. It complements the goal
 * system: goals supply long-horizon objectives, while the temporal engine
 * handles the moment-to-moment scheduling that decides which tasks the
 * system reasons about right now.
 */

import type { ExperienceEvent, Goal, GoalHorizon } from "@cognitive-substrate/core-types";

/**
 * Reuse the goal-system horizon labels so the planner can switch
 * smoothly between micro tactical planning and meta-level reflection.
 */
export type TemporalScale = GoalHorizon;

/** A unit of work scheduled by the temporal engine. */
export interface TemporalTask {
  readonly taskId: string;
  readonly description: string;
  readonly scale: TemporalScale;
  readonly createdAt: string;
  /** Optional ISO-8601 deadline; tasks without one rely on importance + scale. */
  readonly dueAt?: string;
  readonly importance: number;
  /** Caller's effort estimate; feeds the subjective-time allocation. */
  readonly estimatedEffort: number;
  readonly dependencies?: ReadonlyArray<string>;
}

/** Per-task urgency signal computed from importance, deadline, and scale. */
export interface UrgencySignal {
  readonly taskId: string;
  /** Combined urgency in `[0, 1]`. */
  readonly urgency: number;
  /** Negative when the deadline has passed. */
  readonly timeRemainingMs?: number;
  readonly scale: TemporalScale;
}

/**
 * Compute budget expressed in a "subjective time" abstraction:
 *   - inferenceSteps: how many reasoning iterations the engine grants
 *     downstream cognition for the current cycle.
 *   - density: pressure of the current workload, in `[0, 1]`.
 *   - compression: how much the engine should compress reasoning output
 *     to fit the budget, in `[0, 1]`.
 */
export interface SubjectiveTimeBudget {
  readonly inferenceSteps: number;
  readonly density: number;
  readonly compression: number;
}

/** Episodic record produced by `sequenceEpisodes`. */
export interface EpisodicSequence {
  readonly sequenceId: string;
  readonly eventIds: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly summary: string;
}

/** Output of one planning pass. */
export interface TemporalPlan {
  readonly orderedTasks: ReadonlyArray<TemporalTask>;
  readonly urgencySignals: ReadonlyArray<UrgencySignal>;
  readonly subjectiveTime: SubjectiveTimeBudget;
  readonly activeScale: TemporalScale;
}

/** Inputs to `plan()`. */
export interface TemporalPlanningInput {
  readonly tasks: ReadonlyArray<TemporalTask>;
  readonly goals?: ReadonlyArray<Goal>;
  readonly recentEvents?: ReadonlyArray<ExperienceEvent>;
  /** External compute multiplier, default 1. */
  readonly computeBudget?: number;
  /** ISO-8601 wall-clock; defaults to the current time. */
  readonly now?: string;
}
