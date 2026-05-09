import type {
  AttentionAllocation,
  AttentionBudget,
  AttentionCandidate,
  AttentionContext,
  AttentionRoutingResult,
} from "./types.js";

const DEFAULT_BUDGET: AttentionBudget = {
  maxPrimaryItems: 5,
  maxBackgroundItems: 10,
  interruptThreshold: 0.82,
  focusPersistence: 0.2,
  decayRate: 0.05,
};

export class AttentionEngine {
  private readonly budget: AttentionBudget;

  constructor(budget: Partial<AttentionBudget> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  route(
    candidates: ReadonlyArray<AttentionCandidate>,
    context: AttentionContext = {},
  ): AttentionRoutingResult {
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        salience: scoreSalience(candidate, context, this.budget),
      }))
      .sort((left, right) => right.salience - left.salience);

    const allocations = ranked.map<AttentionAllocation>((entry, index) => ({
      candidateId: entry.candidate.candidateId,
      lane: entry.salience >= this.budget.interruptThreshold ? "interrupt" : "primary",
      salience: entry.salience,
      rank: index + 1,
      summary: entry.candidate.summary,
    }));

    const interrupts = allocations.filter((allocation) => allocation.lane === "interrupt");
    const nonInterrupts = allocations.filter((allocation) => allocation.lane !== "interrupt");
    const primary = nonInterrupts.slice(0, this.budget.maxPrimaryItems);
    const background = nonInterrupts.slice(
      this.budget.maxPrimaryItems,
      this.budget.maxPrimaryItems + this.budget.maxBackgroundItems,
    ).map((allocation) => ({ ...allocation, lane: "background" as const }));
    const dropped = nonInterrupts.slice(
      this.budget.maxPrimaryItems + this.budget.maxBackgroundItems,
    );
    const nextFocusId = interrupts[0]?.candidateId ?? primary[0]?.candidateId;

    return {
      primary,
      background,
      interrupts,
      dropped,
      ...(nextFocusId ? { nextFocusId } : {}),
    };
  }
}

export function scoreSalience(
  candidate: AttentionCandidate,
  context: AttentionContext = {},
  budget: AttentionBudget = DEFAULT_BUDGET,
): number {
  const policyNoveltyBias = context.policy?.explorationFactor ?? 0.5;
  const focusBoost = context.activeFocusId === candidate.candidateId ? budget.focusPersistence : 0;
  const agePenalty = ageDecay(candidate.timestamp, budget.decayRate);
  const sourceBoost = candidate.source === "goal" ? 0.08 : candidate.source === "experience" ? 0.05 : 0;

  return clamp(
    candidate.importance * 0.35
      + (candidate.relevance ?? 0.5) * 0.2
      + (candidate.urgency ?? 0.5) * 0.18
      + (candidate.novelty ?? 0.5) * policyNoveltyBias * 0.14
      + (candidate.risk ?? 0) * 0.08
      + focusBoost
      + sourceBoost
      - agePenalty,
  );
}

function ageDecay(timestamp: string | undefined, decayRate: number): number {
  if (!timestamp) return 0;
  const ageMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 0;
  const ageHours = ageMs / 3_600_000;
  return clamp(ageHours * decayRate);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
