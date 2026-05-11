/**
 * Temporal planning and subjective-time allocation.
 *
 * `TemporalEngine.plan` ranks tasks by combined importance, urgency, and
 * scale weight; allocates inference steps proportional to workload
 * density; and infers the active planning horizon from the highest-
 * priority task. `sequenceEpisodes` is a side helper that builds an
 * `EpisodicSequence` summary from a batch of recent experience events.
 */

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

/**
 * Per-scale weight contribution to ranking. Larger horizons get higher
 * weight so that long-horizon work is not consistently starved by short
 * tactical tasks; per-task importance and urgency still dominate.
 */
const SCALE_WEIGHT: Record<TemporalScale, number> = {
  micro: 0.2,
  short: 0.35,
  mid: 0.55,
  long: 0.75,
  meta: 0.9,
};

export class TemporalEngine {
  /**
   * Produces a plan: tasks sorted by combined priority, urgency signals
   * for each, the subjective-time budget, and the active scale.
   */
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

  /**
   * Builds an `EpisodicSequence` summary across the supplied events.
   * Returns undefined for an empty input so that callers can drop the
   * sequence cleanly without inserting a sentinel record.
   */
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

/**
 * Urgency for a single task. When no `dueAt` is set, urgency is driven by
 * importance and scale alone. Otherwise the deadline drives a "horizon
 * pressure" term that saturates at 1.0 once the deadline is within 24h
 * (or has already passed).
 */
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

/**
 * Allocates a subjective-time budget. Density combines event throughput
 * (proxy for incoming attention pressure) with cumulative task effort
 * (proxy for outstanding workload). Inference steps scale with the
 * external compute budget and density; compression rises as density
 * rises so that downstream cognition produces tighter outputs under
 * pressure.
 */
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

/**
 * The active scale is the scale of the top-priority task, falling back to
 * the first goal's horizon and ultimately to `micro` so that the engine
 * always reports a value.
 */
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
