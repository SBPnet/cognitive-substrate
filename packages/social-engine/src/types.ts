/**
 * Social-engine type surface.
 *
 * The social engine maintains a coarse user model from observed
 * experience events: stated beliefs, recent intent, trust, cooperation
 * preference, and deception risk. This information is consumed by the
 * arbitration and policy layers when shaping agent responses to a
 * specific subject.
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";

/** A single claim attributed to the subject. */
export interface UserBelief {
  readonly beliefId: string;
  readonly claim: string;
  readonly confidence: number;
  readonly lastObservedAt: string;
}

/** The full user model maintained by the engine. */
export interface UserModel {
  readonly subjectId: string;
  readonly updatedAt: string;
  readonly beliefs: ReadonlyArray<UserBelief>;
  readonly trustScore: number;
  readonly cooperativePreference: number;
  readonly deceptionRisk: number;
}

/** Coarse intent classification for the latest interaction. */
export interface IntentInference {
  readonly intent: string;
  readonly confidence: number;
  readonly evidenceEventIds: ReadonlyArray<string>;
}

/** Aggregate output of one social assessment. */
export interface SocialAssessment {
  readonly userModel: UserModel;
  readonly intent: IntentInference;
  /** Signed change applied to `trustScore` this cycle, in `[-1, 1]`. */
  readonly trustDelta: number;
  /** Combined trust + cooperation signal in `[0, 1]`. */
  readonly cooperationSignal: number;
}

/** Inputs to one assessment pass. */
export interface SocialInput {
  readonly subjectId: string;
  readonly events: ReadonlyArray<ExperienceEvent>;
  readonly previous?: UserModel;
}
