/**
 * Experiment 21 — AffectEngine: Incident Signal Modulates the Affect Vector
 *
 * The AffectEngine maintains a 5-dimensional neurochemical vector
 * (dopamine, norepinephrine, serotonin, curiosity, contradictionStress)
 * and a coarse MoodState. Each `update(signal)` call blends the prior
 * vector with a new AffectSignal using fixed EMA weights; `coupleAttention`
 * projects the vector onto an AttentionCandidate as a small importance boost.
 *
 * This experiment drives the engine through the four operational incident
 * windows (normal → degraded → outage → recovery) and verifies that the
 * vector and mood track the incident lifecycle.
 *
 * Four hypotheses:
 *
 *   H1 — Feeding outage-window signals (high uncertainty, high contradiction
 *        risk) produces norepinephrine > 0.6 and contradictionStress > 0.5,
 *        and classifies the mood as "stressed" or "cautious".
 *
 *   H2 — Feeding normal-window signals (low uncertainty, low contradiction)
 *        after the outage sequence causes norepinephrine and
 *        contradictionStress to decrease monotonically over 5 updates,
 *        demonstrating EMA smoothing / decay back toward baseline.
 *
 *   H3 — The final mood after 10 normal-window updates following an outage
 *        is "settled" or "exploratory", confirming that sustained low-stress
 *        input drives the engine back to a quiescent state.
 *
 *   H4 — `coupleAttention` produces a higher affectBoost for a high-risk,
 *        high-urgency AttentionCandidate when the engine is in "stressed"
 *        state than when it is in "settled" state, because norepinephrine
 *        and contradictionStress both feed the boost formula.
 *
 * Protocol:
 *   1. Start from a fresh AffectEngine (BASE_VECTOR).
 *   2. Feed 5 normal-window AffectSignals → record baseline vector.
 *   3. Feed 10 outage-window AffectSignals → record peak vector + mood.
 *   4. Record affect boost for a high-risk candidate (H4 stressed side).
 *   5. Feed 10 normal-window AffectSignals → record recovery vector + mood.
 *   6. Record affect boost for the same candidate (H4 settled side).
 *   7. Evaluate H1–H4.
 *
 * No OpenSearch required — AffectEngine is pure in-memory computation.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp21
 */

import { AffectEngine } from "@cognitive-substrate/affect-engine";
import { saveResults } from "./results.js";
import type { AffectSignal, AffectState } from "@cognitive-substrate/affect-engine";
import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";

// ---------------------------------------------------------------------------
// Signal factories
// ---------------------------------------------------------------------------

/** Low-stress signal: quiet operational window */
function normalSignal(): AffectSignal {
  return {
    rewardPredictionError: 0.05,
    novelty: 0.1,
    uncertainty: 0.1,
    contradictionRisk: 0.05,
    sustainedSuccess: 0.85,
  };
}

/** High-stress signal: active outage */
function outageSignal(): AffectSignal {
  return {
    rewardPredictionError: -0.6,
    novelty: 0.7,
    uncertainty: 0.85,
    contradictionRisk: 0.9,
    sustainedSuccess: 0.1,
  };
}

/** A high-risk candidate to probe coupleAttention */
const highRiskCandidate: AttentionCandidate = {
  candidateId: "candidate-incident-alert",
  importance: 0.5,
  novelty: 0.8,
  urgency: 0.9,
  risk: 0.95,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printState(label: string, state: AffectState): void {
  const v = state.vector;
  console.log(
    `  ${label}: mood=${state.mood}` +
      ` dopa=${v.dopamine.toFixed(3)} norepi=${v.norepinephrine.toFixed(3)}` +
      ` sero=${v.serotonin.toFixed(3)} curio=${v.curiosity.toFixed(3)}` +
      ` contraStress=${v.contradictionStress.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 21: AffectEngine — Incident Signal Modulates Affect Vector ===\n");

  const engine = new AffectEngine();

  // Phase 1: 5 normal signals → baseline
  console.log("--- Phase 1: 5 normal signals (baseline) ---");
  let state = engine.current();
  for (let i = 0; i < 5; i++) state = engine.update(normalSignal());
  const baselineState = state;
  printState("after 5 normal", baselineState);

  // Phase 2: 10 outage signals → peak stress
  console.log("\n--- Phase 2: 10 outage signals (peak stress) ---");
  for (let i = 0; i < 10; i++) state = engine.update(outageSignal());
  const stressedState = state;
  printState("after 10 outage", stressedState);

  // H4 stressed side: affectBoost for high-risk candidate
  const stressedCoupling = engine.coupleAttention(highRiskCandidate);
  console.log(`  coupleAttention(stressed): affectBoost=${stressedCoupling.affectBoost.toFixed(4)} adjustedImportance=${stressedCoupling.adjustedCandidate.importance.toFixed(4)}`);

  // H1 evaluation
  const h1Pass =
    stressedState.vector.norepinephrine > 0.6 &&
    stressedState.vector.contradictionStress > 0.5 &&
    (stressedState.mood === "stressed" || stressedState.mood === "cautious");
  console.log(`\nH1 — norepi>0.6 (${stressedState.vector.norepinephrine.toFixed(3)}) + contraStress>0.5 (${stressedState.vector.contradictionStress.toFixed(3)}) + mood∈{stressed,cautious} (${stressedState.mood}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Phase 3: 10 normal signals → recovery; track monotonic decrease
  console.log("\n--- Phase 3: 10 normal signals (recovery) ---");
  const recoveryHistory: Array<{ norepi: number; contraStress: number }> = [];
  for (let i = 0; i < 10; i++) {
    state = engine.update(normalSignal());
    recoveryHistory.push({
      norepi: state.vector.norepinephrine,
      contraStress: state.vector.contradictionStress,
    });
    printState(`  step ${i + 1}`, state);
  }
  const recoveredState = state;

  // H2: norepi and contraStress decrease monotonically over 5 normal updates from peak
  // Use first 5 of the 10 recovery steps
  const first5 = recoveryHistory.slice(0, 5);
  const norepDecreasing = first5.every((s, i) =>
    i === 0 ? s.norepi <= stressedState.vector.norepinephrine : s.norepi <= first5[i - 1]!.norepi,
  );
  const contraDecreasing = first5.every((s, i) =>
    i === 0 ? s.contraStress <= stressedState.vector.contradictionStress : s.contraStress <= first5[i - 1]!.contraStress,
  );
  const h2Pass = norepDecreasing && contraDecreasing;
  console.log(`\nH2 — norepi monotonic↓ over 5 recovery steps: ${norepDecreasing ? "✓" : "✗"}; contraStress monotonic↓: ${contraDecreasing ? "✓" : "✗"}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H3: final mood is settled or exploratory
  const h3Pass = recoveredState.mood === "settled" || recoveredState.mood === "exploratory";
  printState("final (post-recovery)", recoveredState);
  console.log(`\nH3 — mood∈{settled,exploratory} after 10 normal signals: mood=${recoveredState.mood}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H4: stressed affectBoost > settled affectBoost
  // Reset to settled baseline and re-check
  const settledEngine = new AffectEngine();
  for (let i = 0; i < 10; i++) settledEngine.update(normalSignal());
  const settledCoupling = settledEngine.coupleAttention(highRiskCandidate);
  console.log(`\nH4 — coupleAttention affectBoost:`);
  console.log(`  stressed=${stressedCoupling.affectBoost.toFixed(4)}  settled=${settledCoupling.affectBoost.toFixed(4)}`);
  const h4Pass = stressedCoupling.affectBoost > settledCoupling.affectBoost;
  console.log(`  stressed > settled: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Save results
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp21",
    [
      `H1 stressed state norepi=${stressedState.vector.norepinephrine.toFixed(3)} contraStress=${stressedState.vector.contradictionStress.toFixed(3)} mood=${stressedState.mood}: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 monotonic decrease over 5 recovery steps: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 final mood=${recoveredState.mood} ∈ {settled,exploratory}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 stressed affectBoost (${stressedCoupling.affectBoost.toFixed(4)}) > settled (${settledCoupling.affectBoost.toFixed(4)}): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      baselineState: baselineState.vector,
      stressedState: { vector: stressedState.vector, mood: stressedState.mood },
      recoveredState: { vector: recoveredState.vector, mood: recoveredState.mood },
      affectBoost: { stressed: stressedCoupling.affectBoost, settled: settledCoupling.affectBoost },
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
