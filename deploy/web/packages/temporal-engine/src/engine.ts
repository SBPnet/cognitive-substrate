import { randomUUID } from "node:crypto";
import type {
  EpisodicSequence,
  SubjectiveTimeBudget,
  TemporalPlan,
  TemporalPlanningInput,
  TemporalScale,
  TemporalTask,
  UrgencySignal,
} from "./types.js";

const SCALE_WEIGHT: Record<TemporalScale, number> = {
  micro: 0.2,
  short: 0.35,
  mid: 0.55,
  long: 0.75,
  meta: 0.9,
};

export class TemporalEngine {
  plan(input: TemporalPlanningInput): TemporalPlan {
    const now = Date.parse(input.now ?? new Date().toISOString());
    const urgencySignals = input.tasks.map((task) => computeUrgency(task, now));
    const orderedTasks = [...input.tasks].sort(
      (left, right) => taskPriority(right, urgencySignals) - taskPriority(left, urgencySignals),
    );
    const activeScale = inferActiveScale(orderedTasks, input.goals ?? []);
    const subjectiveTime = allocateSubjectiveTime(
      orderedTasks,
      input.recentEvents?.length ?? 0,
      input.computeBudget ?? 1,
    );

    return {
      orderedTasks,
      urgencySignals,
      subjectiveTime,
      activeScale,
    };
  }

  sequenceEpisodes(events: TemporalPlanningInput["recentEvents"] = []): EpisodicSequence | undefined {
    if (events.length === 0) return undefined;
    const ordered = [...events].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (!first || !last) return undefined;

    return {
      sequenceId: randomUUID(),
      eventIds: ordered.map((event) => event.eventId),
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      summary: `Episodic sequence containing ${ordered.length} events from ${first.type} to ${last.type}.`,
    };
  }
}

export function computeUrgency(task: TemporalTask, nowMs: number = Date.now()): UrgencySignal {
  if (!task.dueAt) {
    return {
      taskId: task.taskId,
      urgency: clamp(task.importance * 0.5 + SCALE_WEIGHT[task.scale] * 0.25),
      scale: task.scale,
    };
  }

  const timeRemainingMs = Date.parse(task.dueAt) - nowMs;
  const horizonPressure = timeRemainingMs <= 0 ? 1 : clamp(1 - timeRemainingMs / 86_400_000);
  return {
    taskId: task.taskId,
    urgency: clamp(task.importance * 0.45 + horizonPressure * 0.4 + SCALE_WEIGHT[task.scale] * 0.15),
    timeRemainingMs,
    scale: task.scale,
  };
}

export function allocateSubjectiveTime(
  tasks: ReadonlyArray<TemporalTask>,
  eventDensity: number,
  computeBudget: number,
): SubjectiveTimeBudget {
  const complexity = tasks.reduce((sum, task) => sum + task.estimatedEffort, 0);
  const density = clamp(eventDensity / 10 + complexity / 20);
  const compression = clamp(1 - density * 0.45);
  return {
    inferenceSteps: Math.max(1, Math.round(computeBudget * (1 + density) * 8)),
    density,
    compression,
  };
}

function taskPriority(task: TemporalTask, urgencySignals: ReadonlyArray<UrgencySignal>): number {
  const urgency = urgencySignals.find((signal) => signal.taskId === task.taskId)?.urgency ?? 0;
  return clamp(task.importance * 0.4 + urgency * 0.4 + SCALE_WEIGHT[task.scale] * 0.2);
}

function inferActiveScale(
  tasks: ReadonlyArray<TemporalTask>,
  goals: ReadonlyArray<{ readonly horizon: TemporalScale }>,
): TemporalScale {
  const firstTask = tasks[0];
  if (firstTask) return firstTask.scale;
  return goals[0]?.horizon ?? "micro";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
