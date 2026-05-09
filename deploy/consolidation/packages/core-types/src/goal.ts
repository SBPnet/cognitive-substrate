/**
 * Goal system types. Goals provide temporal persistence across sessions,
 * anchoring policy drift and memory consolidation toward long-horizon objectives.
 */

export type GoalHorizon = "micro" | "short" | "mid" | "long" | "meta";
export type GoalStatus = "active" | "completed" | "stalled" | "cancelled" | "deferred";

export interface Goal {
  readonly goalId: string;
  readonly createdAt: string;
  readonly description: string;
  readonly horizon: GoalHorizon;
  readonly priority: number;
  readonly progress: number;
  readonly status: GoalStatus;
  readonly parentGoalId?: string;
  readonly associatedMemoryIds: ReadonlyArray<string>;
  readonly subgoals: ReadonlyArray<string>;
}

export interface GoalProgressEvent {
  readonly goalId: string;
  readonly timestamp: string;
  readonly progressDelta: number;
  readonly completedSubgoals: ReadonlyArray<string>;
  readonly nextAction?: string;
  readonly sourceExperienceId?: string;
}
