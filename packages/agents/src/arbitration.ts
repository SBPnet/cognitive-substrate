import type { AgentResult, ArbitrationDecision } from "@cognitive-substrate/core-types";

export interface DebateScore {
  readonly coherence: number;
  readonly predictedReward: number;
  readonly memoryAlignment: number;
  readonly riskPenalty: number;
  readonly total: number;
}

export interface ArbitrationRiskForecast {
  readonly riskScore: number;
  readonly confidence: number;
}

export function scoreAgentResult(result: AgentResult): number {
  return scoreDebateCandidate(result).total;
}

export function scoreDebateCandidate(
  result: AgentResult,
  forecast?: ArbitrationRiskForecast,
): DebateScore {
  const memoryAlignment = Math.min(1, result.retrievedMemories.length / 5);
  const coherence = result.proposal.length > 0 && result.reasoning ? 1 : 0.6;
  const predictedReward = forecast
    ? result.confidence * 0.65 + forecast.confidence * 0.35
    : result.confidence;
  const riskPenalty = forecast
    ? result.riskScore * 0.55 + forecast.riskScore * 0.45
    : result.riskScore;
  const total = clamp(
    coherence * 0.25
      + predictedReward * 0.3
      + memoryAlignment * 0.25
      + (1 - riskPenalty) * 0.2,
  );

  return {
    coherence,
    predictedReward: clamp(predictedReward),
    memoryAlignment,
    riskPenalty: clamp(riskPenalty),
    total,
  };
}

export function arbitrate(results: ReadonlyArray<AgentResult>): ArbitrationDecision {
  if (results.length === 0) {
    throw new Error("arbitration requires at least one agent result");
  }

  const scored = results.map((result) => ({
    ...result,
    score: result.score ?? scoreAgentResult(result),
  }));
  const winner = [...scored].sort((left, right) => right.score - left.score)[0];
  if (!winner) {
    throw new Error("arbitration failed to select a winner");
  }

  return {
    winnerId: winner.agentId,
    winnerType: winner.agentType,
    winnerProposal: winner.proposal,
    confidence: winner.confidence,
    allScores: scored.map((result) => ({
      agentId: result.agentId,
      score: result.score,
    })),
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
