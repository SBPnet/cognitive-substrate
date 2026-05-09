import type { OutcomeSimulationModel, SimulatedOutcome, WorldModelSimulationInput } from "./types.js";

export class HeuristicOutcomeSimulationModel implements OutcomeSimulationModel {
  async simulate(input: WorldModelSimulationInput): Promise<SimulatedOutcome> {
    const actionRisk = lexicalRisk(input.actionSummary);
    const stateRisk = lexicalRisk(input.currentStateSummary) * 0.5;
    const memorySupport = Math.min(1, (input.context?.memories.length ?? 0) / 5);
    const goalSupport = Math.min(1, (input.context?.goals.length ?? 0) / 3);
    const prior = input.confidencePrior ?? 0.5;
    const riskScore = clamp(actionRisk * 0.55 + stateRisk * 0.25 + (1 - memorySupport) * 0.2);
    const confidence = clamp(prior * 0.4 + memorySupport * 0.25 + goalSupport * 0.15 + (1 - riskScore) * 0.2);

    return {
      predictedOutcome: summarizeOutcome(input, riskScore, confidence),
      riskScore,
      confidence,
      rationale: "heuristic_risk_memory_goal_support",
    };
  }
}

function summarizeOutcome(
  input: WorldModelSimulationInput,
  riskScore: number,
  confidence: number,
): string {
  const riskBand = riskScore >= 0.7 ? "high-risk" : riskScore >= 0.4 ? "moderate-risk" : "low-risk";
  const confidenceBand = confidence >= 0.7 ? "high-confidence" : confidence >= 0.4 ? "moderate-confidence" : "low-confidence";
  return `${riskBand} ${confidenceBand} outcome forecast for action: ${input.actionSummary}`;
}

function lexicalRisk(text: string): number {
  const normalized = text.toLowerCase();
  const riskTerms = ["delete", "overwrite", "external", "credential", "destructive", "irreversible", "unsafe"];
  const matches = riskTerms.filter((term) => normalized.includes(term)).length;
  return clamp(matches / 3);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
