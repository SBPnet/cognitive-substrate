/**
 * Curiosity-engine type surface.
 *
 * The curiosity engine ranks under-explored states and proposes
 * experiments that would reduce uncertainty most efficiently. It is the
 * exploratory counterpart to the reinforcement engine: rather than
 * adjusting weights based on observed outcomes, it nominates inputs that
 * would yield the most informative outcomes if chosen.
 */

/** A candidate state under consideration for further exploration. */
export interface CuriosityState {
  readonly stateId: string;
  /** Distance from prior memory clusters, in `[0, 1]`. */
  readonly novelty: number;
  /** Posterior uncertainty about the state, in `[0, 1]`. */
  readonly uncertainty: number;
  /** Estimated information gain from one observation, in `[0, 1]`. */
  readonly expectedInformationGain: number;
  readonly visitedCount: number;
}

/** Concrete experiment proposal generated from a `CuriosityState`. */
export interface ExperimentPlan {
  readonly experimentId: string;
  readonly stateId: string;
  /** One-sentence hypothesis about what running the experiment would teach. */
  readonly hypothesis: string;
  readonly expectedInformationGain: number;
  readonly riskScore: number;
  readonly priority: number;
}

/** Output of one assessment pass. */
export interface CuriosityAssessment {
  /** Top-of-list curiosity priority; doubles as the curiosity reward signal. */
  readonly curiosityReward: number;
  readonly prioritizedStates: ReadonlyArray<CuriosityState>;
  readonly experiments: ReadonlyArray<ExperimentPlan>;
}
