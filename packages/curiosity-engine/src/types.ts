export interface CuriosityState {
  readonly stateId: string;
  readonly novelty: number;
  readonly uncertainty: number;
  readonly expectedInformationGain: number;
  readonly visitedCount: number;
}

export interface ExperimentPlan {
  readonly experimentId: string;
  readonly stateId: string;
  readonly hypothesis: string;
  readonly expectedInformationGain: number;
  readonly riskScore: number;
  readonly priority: number;
}

export interface CuriosityAssessment {
  readonly curiosityReward: number;
  readonly prioritizedStates: ReadonlyArray<CuriosityState>;
  readonly experiments: ReadonlyArray<ExperimentPlan>;
}
