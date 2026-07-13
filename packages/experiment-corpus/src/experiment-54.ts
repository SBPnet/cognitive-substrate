/**
 * Experiment 54 — Policy explorationFactor Recovery After Incident
 *
 * Exp 41/44 showed explorationFactor collapsing under outage signals and not
 * rebounding during recovery. This experiment certifies
 * `applyExplorationRecovery` in policy-engine: after a depressed outage phase,
 * positive low-contradiction recovery turns raise explorationFactor within N
 * turns.
 *
 * Protocol (in-memory PolicyEngine, no OpenSearch required):
 *   turns 1–20  : outage (reward=-0.8, confidence=0.9, contradiction=0.8)
 *   turns 21–40 : recovery (reward=+0.8, confidence=0.7, contradiction=0.1,
 *                 goalProgress=0.7)
 *
 * Hypotheses:
 *
 *   H1 — After outage, explorationFactor ≤ 0.25.
 *
 *   H2 — After recovery, explorationFactor > end-of-outage value.
 *
 *   H3 — Recovery raises explorationFactor by ≥ 0.15 absolute within 20 turns.
 *
 *   H4 — During outage, explorationFactor is monotone non-increasing.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp54
 */

import { randomUUID } from "node:crypto";
import {
  PolicyEngine,
  createDefaultPolicyState,
  type PolicyEvaluationInput,
  type PolicyStore,
  type PolicyUpdateResult,
} from "@cognitive-substrate/policy-engine";
import type { PolicyState, PolicyUpdateEvent } from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

class MemoryPolicyStore implements PolicyStore {
  private current: PolicyState | undefined;

  async getCurrent(): Promise<PolicyState | undefined> {
    return this.current;
  }

  async saveSnapshot(state: PolicyState, _event: PolicyUpdateEvent): Promise<void> {
    this.current = state;
  }
}

async function main(): Promise<void> {
  console.log("=== Experiment 54 — Policy explorationFactor Recovery ===\n");

  const store = new MemoryPolicyStore();
  await store.saveSnapshot(createDefaultPolicyState(), {
    policyId: "seed",
    timestamp: new Date().toISOString(),
    previousVersion: "none",
    nextVersion: "policy-v0",
    delta: {},
    rewardDelta: 0,
    sourceExperienceId: "seed",
  });

  const engine = new PolicyEngine({ store });
  const efs: number[] = [(await engine.getCurrentPolicy()).explorationFactor];

  const outageInput = (): PolicyEvaluationInput => ({
    sourceExperienceId: randomUUID(),
    rewardDelta: -0.8,
    confidence: 0.9,
    contradictionRisk: 0.8,
    memoryUsefulness: 0.3,
    toolUsefulness: 0.3,
    goalProgress: 0.2,
  });

  const recoveryInput = (): PolicyEvaluationInput => ({
    sourceExperienceId: randomUUID(),
    rewardDelta: 0.8,
    confidence: 0.7,
    contradictionRisk: 0.1,
    memoryUsefulness: 0.7,
    toolUsefulness: 0.6,
    goalProgress: 0.7,
  });

  let last: PolicyUpdateResult | undefined;
  for (let i = 0; i < 20; i++) {
    last = await engine.applyEvaluation(outageInput());
    efs.push(last.next.explorationFactor);
  }
  const endOutage = last!.next.explorationFactor;
  console.log(`End outage ef=${endOutage.toFixed(4)}`);

  for (let i = 0; i < 20; i++) {
    last = await engine.applyEvaluation(recoveryInput());
    efs.push(last.next.explorationFactor);
  }
  const endRecovery = last!.next.explorationFactor;
  console.log(`End recovery ef=${endRecovery.toFixed(4)}`);

  const outageSeries = efs.slice(0, 21);
  const monotoneOutage = outageSeries.every(
    (v, i) => i === 0 || v <= outageSeries[i - 1]! + 1e-9,
  );

  const h1Pass = endOutage <= 0.25;
  const h2Pass = endRecovery > endOutage;
  const h3Pass = endRecovery - endOutage >= 0.15;
  const h4Pass = monotoneOutage;

  console.log(`\nH1 — ef ≤ 0.25 after outage: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — ef recovers above outage: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — Δef ≥ 0.15 in recovery: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — outage monotone non-increasing: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-54",
    [
      `H1 outage collapse: ${h1Pass ? "PASS" : "FAIL"} (ef=${endOutage.toFixed(4)})`,
      `H2 recovery rise: ${h2Pass ? "PASS" : "FAIL"} (${endOutage.toFixed(4)}→${endRecovery.toFixed(4)})`,
      `H3 delta≥0.15: ${h3Pass ? "PASS" : "FAIL"} (Δ=${(endRecovery - endOutage).toFixed(4)})`,
      `H4 monotone outage: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("\n"),
    { endOutage, endRecovery, efs, h1Pass, h2Pass, h3Pass, h4Pass },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
