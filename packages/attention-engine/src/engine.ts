/**
 * Salience routing engine.
 *
 * `AttentionEngine.route` ranks candidates by `scoreSalience` and assigns
 * them to lanes under a fixed budget. The salience score combines static
 * candidate features (importance, relevance, urgency, novelty, risk) with
 * runtime context (active focus, exploration policy, age decay). Items
 * that exceed `interruptThreshold` bypass the budget and are emitted as
 * interrupts; the remaining candidates are sliced into primary and
 * background lanes, with anything past the budget marked `dropped`.
 */

import type {
  AttentionAllocation,
  AttentionBudget,
  AttentionCandidate,
  AttentionContext,
  AttentionRoutingResult,
} from "./types.js";

/**
 * Conservative default budget. The values target a small working set
 * (5 primary, 10 background) with an interrupt threshold close to but
 * below 1.0 so that genuinely high-salience items can preempt focus.
 */
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

  /**
   * Routes a batch of candidates to lanes. The returned allocations are
   * ranked globally by salience; lane assignment uses the budget plus
   * the interrupt threshold.
   */
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

/**
 * Computes the per-candidate salience score.
 *
 * Weight rationale (updated from Experiment 6 findings):
 *   importance  0.29  — still the primary anchor; reduced from 0.35 to give
 *                       novelty enough headroom to produce rank crossovers
 *   relevance   0.20  — topical fit with the current cycle input
 *   urgency     0.18  — time-criticality
 *   novelty     0.30  — policy-modulated by explorationFactor; raised from 0.14
 *                       so that T=0.9 can contribute up to 0.27, approaching
 *                       importance's 0.29 ceiling and enabling ADHD-pattern
 *                       attentional switching without exceeding it
 *   risk        0.08  — small positive term; risky items stay visible
 *
 * At T=0.5 (default), novelty contributes 0.15 — similar to the prior 0.14
 * ceiling. The change is felt at T≥0.7 where novelty begins competing with
 * importance for rank position. Experiment 6 showed the prior 0.14 coefficient
 * kept cluster-B memories in the background lane at all T values in [0,1];
 * 0.30 allows them to reach primary at T=0.9.
 */
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
    candidate.importance * 0.29
      + (candidate.relevance ?? 0.5) * 0.2
      + (candidate.urgency ?? 0.5) * 0.18
      + (candidate.novelty ?? 0.5) * policyNoveltyBias * 0.30
      + (candidate.risk ?? 0) * 0.08
      + focusBoost
      + sourceBoost
      - agePenalty,
  );
}

/** Linear hourly decay applied to candidates that carry a timestamp. */
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
