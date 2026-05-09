import type { ExperienceEvent } from "@cognitive-substrate/core-types";

export interface UserBelief {
  readonly beliefId: string;
  readonly claim: string;
  readonly confidence: number;
  readonly lastObservedAt: string;
}

export interface UserModel {
  readonly subjectId: string;
  readonly updatedAt: string;
  readonly beliefs: ReadonlyArray<UserBelief>;
  readonly trustScore: number;
  readonly cooperativePreference: number;
  readonly deceptionRisk: number;
}

export interface IntentInference {
  readonly intent: string;
  readonly confidence: number;
  readonly evidenceEventIds: ReadonlyArray<string>;
}

export interface SocialAssessment {
  readonly userModel: UserModel;
  readonly intent: IntentInference;
  readonly trustDelta: number;
  readonly cooperationSignal: number;
}

export interface SocialInput {
  readonly subjectId: string;
  readonly events: ReadonlyArray<ExperienceEvent>;
  readonly previous?: UserModel;
}
