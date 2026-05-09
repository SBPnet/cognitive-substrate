import type { ExperienceEvent, Goal, GoalHorizon } from "@cognitive-substrate/core-types";

export type TemporalScale = GoalHorizon;

export interface TemporalTask {
  readonly taskId: string;
  readonly description: string;
  readonly scale: TemporalScale;
  readonly createdAt: string;
  readonly dueAt?: string;
  readonly importance: number;
  readonly estimatedEffort: number;
  readonly dependencies?: ReadonlyArray<string>;
}

export interface UrgencySignal {
  readonly taskId: string;
  readonly urgency: number;
  readonly timeRemainingMs?: number;
  readonly scale: TemporalScale;
}

export interface SubjectiveTimeBudget {
  readonly inferenceSteps: number;
  readonly density: number;
  readonly compression: number;
}

export interface EpisodicSequence {
  readonly sequenceId: string;
  readonly eventIds: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly summary: string;
}

export interface TemporalPlan {
  readonly orderedTasks: ReadonlyArray<TemporalTask>;
  readonly urgencySignals: ReadonlyArray<UrgencySignal>;
  readonly subjectiveTime: SubjectiveTimeBudget;
  readonly activeScale: TemporalScale;
}

export interface TemporalPlanningInput {
  readonly tasks: ReadonlyArray<TemporalTask>;
  readonly goals?: ReadonlyArray<Goal>;
  readonly recentEvents?: ReadonlyArray<ExperienceEvent>;
  readonly computeBudget?: number;
  readonly now?: string;
}
