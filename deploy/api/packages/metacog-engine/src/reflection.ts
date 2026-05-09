import { randomUUID } from "node:crypto";
import type { SelfModificationProposal } from "@cognitive-substrate/core-types";
import type {
  ReflectionBudget,
  ReflectionInput,
  ReflectionResult,
  SelfModificationPublisher,
} from "./types.js";

const DEFAULT_BUDGET: ReflectionBudget = {
  maxReflectionsPerSession: 3,
  maxRiskForAutomaticProposal: 0.4,
};

export class ReflectionEngine {
  private readonly budget: ReflectionBudget;
  private readonly publisher: SelfModificationPublisher | undefined;

  constructor(options: {
    readonly budget?: ReflectionBudget;
    readonly publisher?: SelfModificationPublisher;
  } = {}) {
    this.budget = options.budget ?? DEFAULT_BUDGET;
    this.publisher = options.publisher;
  }

  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const budgetAllowed =
      (input.priorReflectionsInSession ?? 0) < this.budget.maxReflectionsPerSession;
    const confidence = calibrateConfidence(input);
    const calibrationError = Math.abs(
      confidence - (input.loopResult.actionResult.success ? 1 : 0),
    );
    const failureAttribution = attributeFailure(input);
    const strategyReflection = reflectOnStrategy(input, calibrationError);
    const proposal = budgetAllowed
      ? maybeProposeSelfModification(input, calibrationError, this.budget)
      : undefined;

    if (proposal) {
      await this.publisher?.publish(proposal);
    }

    return {
      confidence,
      calibrationError,
      failureAttribution,
      strategyReflection,
      budgetAllowed,
      ...(proposal ? { proposal } : {}),
    };
  }
}

function calibrateConfidence(input: ReflectionInput): number {
  const agentConfidence = input.loopResult.agentResult.confidence;
  const risk = input.loopResult.agentResult.riskScore;
  const memorySupport = Math.min(1, input.loopResult.context.memories.length / 5);
  return clamp(agentConfidence * 0.6 + memorySupport * 0.25 + (1 - risk) * 0.15);
}

function attributeFailure(input: ReflectionInput): string {
  if (input.loopResult.actionResult.success) return "no_failure";
  if (input.loopResult.agentResult.riskScore > 0.7) return "risk_underestimated";
  if (input.loopResult.context.memories.length === 0) return "insufficient_memory_context";
  return "execution_failure";
}

function reflectOnStrategy(
  input: ReflectionInput,
  calibrationError: number,
): string {
  if (calibrationError > 0.5) {
    return "Confidence calibration requires adjustment before similar actions.";
  }
  if (input.loopResult.context.memories.length === 0) {
    return "Future reasoning should expand retrieval before acting.";
  }
  return "Current strategy remained within confidence and risk bounds.";
}

function maybeProposeSelfModification(
  input: ReflectionInput,
  calibrationError: number,
  budget: ReflectionBudget,
): SelfModificationProposal | undefined {
  const risk = input.loopResult.agentResult.riskScore;
  if (calibrationError < 0.35 && risk <= budget.maxRiskForAutomaticProposal) {
    return undefined;
  }

  return {
    mutationId: randomUUID(),
    timestamp: new Date().toISOString(),
    mutationType: "strategy_adjustment",
    description: reflectOnStrategy(input, calibrationError),
    expectedGain: clamp(calibrationError),
    stabilityRisk: clamp(risk),
    approved: false,
    rollbackAvailable: true,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
