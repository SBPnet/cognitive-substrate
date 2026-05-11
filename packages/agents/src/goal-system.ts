/**
 * Goal system: hierarchy management, selection, and progress tracking.
 *
 * The goal system is the long-horizon counterpart to the temporal
 * engine. Goals are persisted (via a `GoalStore`), ranked for
 * selection by combined priority, horizon weight, progress
 * opportunity, and event relevance, and decomposed into subgoals at
 * the next-lower horizon. Progress events are mirrored onto Kafka
 * via an optional `GoalProgressPublisher`.
 */

import { randomUUID } from "node:crypto";
import type {
  ExperienceEvent,
  Goal,
  GoalHorizon,
  GoalProgressEvent,
  GoalStatus,
  PolicyState,
} from "@cognitive-substrate/core-types";

/** Canonical horizon ordering used for monotonic decomposition. */
const HORIZON_ORDER: ReadonlyArray<GoalHorizon> = ["micro", "short", "mid", "long", "meta"];

const HORIZON_PRIORITY_WEIGHT: Record<GoalHorizon, number> = {
  micro: 0.1,
  short: 0.25,
  mid: 0.45,
  long: 0.7,
  meta: 0.9,
};

export interface GoalCreationInput {
  readonly description: string;
  readonly horizon: GoalHorizon;
  readonly priority?: number;
  readonly parentGoalId?: string;
  readonly associatedMemoryIds?: ReadonlyArray<string>;
}

export interface GoalSelectionContext {
  readonly goals: ReadonlyArray<Goal>;
  readonly policy?: Partial<PolicyState>;
  readonly event?: ExperienceEvent;
}

export interface GoalProgressInput {
  readonly goalId: string;
  readonly progressDelta: number;
  readonly completedSubgoals?: ReadonlyArray<string>;
  readonly nextAction?: string;
  readonly sourceExperienceId?: string;
}

/** Persistence contract for goals. */
export interface GoalStore {
  save(goal: Goal): Promise<void>;
  get(goalId: string): Promise<Goal | undefined>;
  listActive(): Promise<ReadonlyArray<Goal>>;
}

/** Optional fan-out hook used to broadcast progress events on Kafka. */
export interface GoalProgressPublisher {
  publish(event: GoalProgressEvent): Promise<void>;
}

export class InMemoryGoalStore implements GoalStore {
  private readonly goals = new Map<string, Goal>();

  async save(goal: Goal): Promise<void> {
    this.goals.set(goal.goalId, goal);
  }

  async get(goalId: string): Promise<Goal | undefined> {
    return this.goals.get(goalId);
  }

  async listActive(): Promise<ReadonlyArray<Goal>> {
    return [...this.goals.values()].filter((goal) => goal.status === "active");
  }
}

export class GoalSystem {
  private readonly store: GoalStore;
  private readonly publisher: GoalProgressPublisher | undefined;

  constructor(options: {
    readonly store?: GoalStore;
    readonly publisher?: GoalProgressPublisher;
  } = {}) {
    this.store = options.store ?? new InMemoryGoalStore();
    this.publisher = options.publisher;
  }

  async createGoal(input: GoalCreationInput): Promise<Goal> {
    const goal: Goal = {
      goalId: randomUUID(),
      createdAt: new Date().toISOString(),
      description: input.description,
      horizon: input.horizon,
      priority: clamp(input.priority ?? defaultPriority(input.horizon)),
      progress: 0,
      status: "active",
      ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
      associatedMemoryIds: input.associatedMemoryIds ?? [],
      subgoals: [],
    };

    await this.store.save(goal);
    return goal;
  }

  async decomposeGoal(
    parent: Goal,
    subgoalDescriptions: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Goal>> {
    const childHorizon = nextLowerHorizon(parent.horizon);
    const subgoals = await Promise.all(
      subgoalDescriptions.map((description) =>
        this.createGoal({
          description,
          horizon: childHorizon,
          priority: parent.priority * 0.9,
          parentGoalId: parent.goalId,
          associatedMemoryIds: parent.associatedMemoryIds,
        }),
      ),
    );

    await this.store.save({
      ...parent,
      subgoals: subgoals.map((goal) => goal.goalId),
    });

    return subgoals;
  }

  async listActiveGoals(): Promise<ReadonlyArray<Goal>> {
    return this.store.listActive();
  }

  selectNextGoal(context: GoalSelectionContext): Goal | undefined {
    return [...context.goals]
      .filter((goal) => goal.status === "active")
      .sort((left, right) => goalSelectionScore(right, context) - goalSelectionScore(left, context))[0];
  }

  async recordProgress(input: GoalProgressInput): Promise<GoalProgressEvent> {
    const goal = await this.store.get(input.goalId);
    if (!goal) {
      throw new Error(`unknown goal: ${input.goalId}`);
    }

    const progress = clamp(goal.progress + input.progressDelta);
    const status: GoalStatus = progress >= 1 ? "completed" : goal.status;
    await this.store.save({ ...goal, progress, status });

    const event: GoalProgressEvent = {
      goalId: input.goalId,
      timestamp: new Date().toISOString(),
      progressDelta: input.progressDelta,
      completedSubgoals: input.completedSubgoals ?? [],
      ...(input.nextAction ? { nextAction: input.nextAction } : {}),
      ...(input.sourceExperienceId ? { sourceExperienceId: input.sourceExperienceId } : {}),
    };

    await this.publisher?.publish(event);
    return event;
  }
}

export function goalSelectionScore(goal: Goal, context: GoalSelectionContext): number {
  const persistence = context.policy?.goalPersistence ?? 0.5;
  const horizonWeight = HORIZON_PRIORITY_WEIGHT[goal.horizon] * persistence;
  const progressOpportunity = 1 - goal.progress;
  const eventRelevance = context.event ? scoreGoalRelevance(goal, context.event) : 0.5;
  return clamp(goal.priority * 0.45 + horizonWeight * 0.2 + progressOpportunity * 0.15 + eventRelevance * 0.2);
}

export function scoreGoalRelevance(goal: Goal, event: ExperienceEvent): number {
  const descriptionTokens = tokenSet(goal.description);
  const eventTokens = tokenSet(event.input.text);
  const tokenOverlap = [...descriptionTokens].filter((token) => eventTokens.has(token)).length;
  const tagOverlap = goal.associatedMemoryIds.includes(event.eventId) ? 1 : 0;
  return clamp(tokenOverlap / Math.max(1, descriptionTokens.size) + tagOverlap * 0.25);
}

function nextLowerHorizon(horizon: GoalHorizon): GoalHorizon {
  const index = HORIZON_ORDER.indexOf(horizon);
  return HORIZON_ORDER[Math.max(0, index - 1)] ?? "micro";
}

function defaultPriority(horizon: GoalHorizon): number {
  return clamp(0.4 + HORIZON_PRIORITY_WEIGHT[horizon] * 0.5);
}

function tokenSet(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/u)
      .filter((token) => token.length > 3),
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
