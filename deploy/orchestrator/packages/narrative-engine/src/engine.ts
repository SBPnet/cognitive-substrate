import type { IdentityState, IdentityUpdateEvent } from "@cognitive-substrate/core-types";
import {
  accumulateIdentityVector,
  createDefaultIdentityState,
  driftMagnitude,
  identityDelta,
  stabilizeIdentityDrift,
} from "./scoring.js";
import { synthesizeNarrativeSelfModel } from "./synthesis.js";
import type {
  DriftStabilizationOptions,
  IdentityAccumulationOptions,
  IdentityFormationInput,
  IdentityFormationResult,
  IdentityUpdatePublisher,
} from "./types.js";

export interface NarrativeEngineConfig {
  readonly publisher?: IdentityUpdatePublisher;
  readonly accumulation?: IdentityAccumulationOptions;
  readonly stabilization?: DriftStabilizationOptions;
  readonly defaultIdentityId?: string;
}

export class NarrativeEngine {
  private readonly publisher: IdentityUpdatePublisher | undefined;
  private readonly accumulation: IdentityAccumulationOptions;
  private readonly stabilization: DriftStabilizationOptions;
  private readonly defaultIdentityId: string;

  constructor(config: NarrativeEngineConfig = {}) {
    this.publisher = config.publisher;
    this.accumulation = config.accumulation ?? {};
    this.stabilization = config.stabilization ?? {};
    this.defaultIdentityId = config.defaultIdentityId ?? "default-identity";
  }

  async updateIdentity(input: IdentityFormationInput): Promise<IdentityFormationResult> {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const previous = resolvePreviousIdentity(input, this.defaultIdentityId, timestamp);
    const proposed = accumulateIdentityVector(
      previous,
      input.evidence,
      timestamp,
      this.accumulation,
    );
    const next = stabilizeIdentityDrift(previous, proposed, this.stabilization);
    const selfModel = synthesizeNarrativeSelfModel(previous, next, input.evidence);
    const event = createIdentityUpdateEvent(
      previous,
      next,
      selfModel.summary,
      selfModel.coherenceScore,
      input.evidence,
    );

    await this.publisher?.publish(event);

    return {
      previous,
      proposed,
      next,
      selfModel,
      event,
    };
  }
}

function resolvePreviousIdentity(
  input: IdentityFormationInput,
  defaultIdentityId: string,
  timestamp: string,
): IdentityState {
  if (input.previous) return input.previous;
  return createDefaultIdentityState(input.identityId ?? defaultIdentityId, timestamp);
}

function createIdentityUpdateEvent(
  previous: IdentityState,
  next: IdentityState,
  narrativeSummary: string,
  coherenceScore: number,
  evidence: IdentityFormationInput["evidence"],
): IdentityUpdateEvent {
  const delta = identityDelta(previous, next);
  const sourceMemoryIds = evidence.map((item) => item.sourceMemoryId);

  return {
    identityId: next.identityId,
    timestamp: next.timestamp,
    previous,
    next,
    delta,
    coherenceScore,
    driftMagnitude: driftMagnitude(previous, next),
    narrativeSummary,
    sourceMemoryIds,
  };
}
