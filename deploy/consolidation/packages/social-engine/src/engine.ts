import { randomUUID } from "node:crypto";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { IntentInference, SocialAssessment, SocialInput, UserBelief, UserModel } from "./types.js";

export class SocialEngine {
  assess(input: SocialInput): SocialAssessment {
    const intent = inferIntent(input.events);
    const trustDelta = computeTrustDelta(input.events);
    const deceptionRisk = computeDeceptionRisk(input.events, input.previous?.deceptionRisk ?? 0.1);
    const userModel: UserModel = {
      subjectId: input.subjectId,
      updatedAt: new Date().toISOString(),
      beliefs: mergeBeliefs(input.previous?.beliefs ?? [], extractBeliefs(input.events)),
      trustScore: clamp((input.previous?.trustScore ?? 0.5) + trustDelta - deceptionRisk * 0.1),
      cooperativePreference: clamp((input.previous?.cooperativePreference ?? 0.5) + intent.confidence * 0.1),
      deceptionRisk,
    };

    return {
      userModel,
      intent,
      trustDelta,
      cooperationSignal: clamp(userModel.trustScore * 0.6 + userModel.cooperativePreference * 0.4),
    };
  }
}

export function inferIntent(events: ReadonlyArray<ExperienceEvent>): IntentInference {
  const text = events.map((event) => event.input.text.toLowerCase()).join(" ");
  const intent = text.includes("why") || text.includes("explain")
    ? "explanation_request"
    : text.includes("fix") || text.includes("implement")
      ? "implementation_request"
      : "general_interaction";

  return {
    intent,
    confidence: Math.min(1, 0.4 + events.length * 0.12),
    evidenceEventIds: events.map((event) => event.eventId),
  };
}

function extractBeliefs(events: ReadonlyArray<ExperienceEvent>): ReadonlyArray<UserBelief> {
  return events
    .filter((event) => event.input.text.length > 0)
    .slice(-5)
    .map((event) => ({
      beliefId: randomUUID(),
      claim: event.input.text.slice(0, 240),
      confidence: event.evaluation?.selfAssessedQuality ?? 0.5,
      lastObservedAt: event.timestamp,
    }));
}

function mergeBeliefs(
  previous: ReadonlyArray<UserBelief>,
  next: ReadonlyArray<UserBelief>,
): ReadonlyArray<UserBelief> {
  return [...previous, ...next].slice(-20);
}

function computeTrustDelta(events: ReadonlyArray<ExperienceEvent>): number {
  const successes = events.filter((event) => event.result?.success === true).length;
  const failures = events.filter((event) => event.result?.success === false).length;
  return clampSigned((successes - failures) / Math.max(1, events.length) * 0.1);
}

function computeDeceptionRisk(events: ReadonlyArray<ExperienceEvent>, prior: number): number {
  const contradictionTerms = events.filter((event) =>
    /contradict|false|deceive|mislead/iu.test(event.input.text),
  ).length;
  return clamp(prior * 0.8 + (contradictionTerms / Math.max(1, events.length)) * 0.2);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
