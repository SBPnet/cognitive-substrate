import { randomUUID } from "node:crypto";
import { ConstitutionEngine } from "@cognitive-substrate/constitution-engine";
import type { IdentityState, PolicyState, SelfModificationProposal } from "@cognitive-substrate/core-types";
import { DevelopmentEngine, type DevelopmentState, type CurriculumItem } from "@cognitive-substrate/development-engine";

export interface OpenEndedEvolutionInput {
  readonly policy: PolicyState;
  readonly identity: IdentityState;
  readonly development: DevelopmentState;
  readonly curriculum: ReadonlyArray<CurriculumItem>;
}

export interface OpenEndedEvolutionResult {
  readonly proposals: ReadonlyArray<SelfModificationProposal>;
  readonly approvedProposalIds: ReadonlyArray<string>;
  readonly selectedCurriculumIds: ReadonlyArray<string>;
  readonly phaseTransitionDetected: boolean;
}

export class OpenEndedEvolutionEngine {
  private readonly constitution: ConstitutionEngine;
  private readonly development: DevelopmentEngine;

  constructor(options: {
    readonly constitution?: ConstitutionEngine;
    readonly development?: DevelopmentEngine;
  } = {}) {
    this.constitution = options.constitution ?? new ConstitutionEngine();
    this.development = options.development ?? new DevelopmentEngine();
  }

  evaluate(input: OpenEndedEvolutionInput): OpenEndedEvolutionResult {
    const developmentAssessment = this.development.assess(input.development, input.curriculum);
    const proposals = developmentAssessment.selectedCurriculum.map((item) => proposalFromCurriculum(item));
    const approvedProposalIds = proposals
      .filter((proposal) =>
        this.constitution.assess({
          policy: input.policy,
          identity: input.identity,
          proposal,
        }).approved,
      )
      .map((proposal) => proposal.mutationId);

    return {
      proposals,
      approvedProposalIds,
      selectedCurriculumIds: developmentAssessment.selectedCurriculum.map((item) => item.itemId),
      phaseTransitionDetected: developmentAssessment.phaseTransitionDetected,
    };
  }
}

export async function runOpenEndedEvolutionMode(): Promise<void> {
  const engine = new OpenEndedEvolutionEngine();
  const result = engine.evaluate(defaultInput());
  process.stdout.write(
    `[open-ended] generated=${result.proposals.length} approved=${result.approvedProposalIds.length}\n`,
  );
}

function proposalFromCurriculum(item: CurriculumItem): SelfModificationProposal {
  return {
    mutationId: randomUUID(),
    timestamp: new Date().toISOString(),
    mutationType: "capability_search",
    description: `Explore capability ${item.capabilityId} with curriculum item ${item.itemId}.`,
    expectedGain: item.expectedGain,
    stabilityRisk: Math.max(0, item.difficulty - item.expectedGain),
    approved: false,
    rollbackAvailable: true,
  };
}

function defaultInput(): OpenEndedEvolutionInput {
  const timestamp = new Date().toISOString();
  return {
    policy: {
      version: "open-ended-default",
      timestamp,
      retrievalBias: 0.5,
      toolBias: 0.5,
      riskTolerance: 0.4,
      memoryTrust: 0.6,
      explorationFactor: 0.7,
      goalPersistence: 0.7,
      workingMemoryDecayRate: 0.4,
    },
    identity: {
      identityId: "open-ended-default",
      timestamp,
      curiosity: 0.7,
      caution: 0.5,
      verbosity: 0.5,
      toolDependence: 0.5,
      explorationPreference: 0.7,
      stabilityScore: 0.65,
    },
    development: {
      phase: "integrative",
      unlockedSubsystems: [],
      capabilities: [
        { capabilityId: "abstraction", score: 0.72, evidenceCount: 12 },
        { capabilityId: "constitution", score: 0.7, evidenceCount: 10 },
      ],
    },
    curriculum: [
      { itemId: "search-abstraction", capabilityId: "abstraction", difficulty: 0.75, expectedGain: 0.18 },
      { itemId: "search-grounding", capabilityId: "grounding", difficulty: 0.65, expectedGain: 0.2 },
    ],
  };
}
