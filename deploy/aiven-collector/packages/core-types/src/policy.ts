/**
 * Policy types governing adaptive behavioral drift.
 * Policy state is continuously updated by the reinforcement engine and
 * propagated to all subsystems that make retrieval or action decisions.
 */

/**
 * The runtime policy vector maintained by the policy engine.
 * All values are clamped to [0, 1].
 */
export interface PolicyState {
  readonly version: string;
  readonly timestamp: string;

  /** Bias toward memory retrieval over in-weights inference. */
  readonly retrievalBias: number;

  /** Preference for tool invocation over pure reasoning. */
  readonly toolBias: number;

  /** Tolerance for uncertain or risky actions. */
  readonly riskTolerance: number;

  /** Degree of trust placed in retrieved memories. */
  readonly memoryTrust: number;

  /** Propensity to explore novel strategies rather than exploit known ones. */
  readonly explorationFactor: number;

  /** Weight given to long-horizon goals over immediate task completion. */
  readonly goalPersistence: number;

  /** How aggressively working memory is pruned between turns. */
  readonly workingMemoryDecayRate: number;
}

/** A single policy update event written to OpenSearch and emitted on Kafka. */
export interface PolicyUpdateEvent {
  readonly policyId: string;
  readonly timestamp: string;
  readonly previousVersion: string;
  readonly nextVersion: string;
  readonly delta: Partial<Omit<PolicyState, "version" | "timestamp">>;
  readonly rewardDelta: number;
  readonly sourceExperienceId: string;
  readonly sourceClusterId?: string;
}

/** Identity state — the slow-moving attractor that stabilizes behavior. */
export interface IdentityState {
  readonly identityId: string;
  readonly timestamp: string;

  /** Degree to which the system pursues novel information. */
  readonly curiosity: number;

  /** Degree to which the system avoids risk and contradiction. */
  readonly caution: number;

  /** Preference for verbose, detailed responses. */
  readonly verbosity: number;

  /** Reliance on external tools over internal reasoning. */
  readonly toolDependence: number;

  /** Preference for exploratory strategies. */
  readonly explorationPreference: number;

  /** Resistance to rapid identity drift. */
  readonly stabilityScore: number;
}

/** A single identity update event emitted after narrative stabilization. */
export interface IdentityUpdateEvent {
  readonly identityId: string;
  readonly timestamp: string;
  readonly previous: IdentityState;
  readonly next: IdentityState;
  readonly delta: Partial<Omit<IdentityState, "identityId" | "timestamp">>;
  readonly coherenceScore: number;
  readonly driftMagnitude: number;
  readonly narrativeSummary: string;
  readonly sourceMemoryIds: ReadonlyArray<string>;
}
