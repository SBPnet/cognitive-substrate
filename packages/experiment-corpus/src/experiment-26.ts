/**
 * Experiment 26 — GroundingEngine → WorldModelEngine → ConstitutionEngine Pipeline
 *
 * Three engines that form the sensing and safety pipeline:
 *
 *   1. GroundingEngine: converts raw sensor readings into ExperienceEvents
 *      and proposes active-inference probes. Tested against the operational
 *      incident lifecycle — normal metrics, then an outage spike in p95
 *      latency and error rate.
 *
 *   2. WorldModelEngine: predicts outcomes for candidate actions. The
 *      heuristic model scores risk from lexical tokens ("delete",
 *      "external", "credential", etc.) and confidence from memory/goal
 *      context. Tested with a safe action (explain a runbook), a risky
 *      action (overwrite credentials), and a well-supported action (with
 *      memory + goal context).
 *
 *   3. ConstitutionEngine: approves or rejects changes to identity/policy.
 *      Tested with: a healthy identity (approved), an identity with low
 *      stability (violation), a reward-corruption signal (quarantine), and
 *      the post-outage identity from Exp 25 as a real-world integration test.
 *
 * Four hypotheses:
 *
 *   H1 — GroundingEngine: outage sensor readings produce higher importance
 *        events than normal readings. p95 latency=1200ms → importance=1.0
 *        (clamped from 1200/100=12); normal latency=45ms → importance=0.45.
 *        Active-inference probes are proposed for any non-zero reading.
 *
 *   H2 — WorldModelEngine: risky action ("overwrite credential") scores
 *        riskScore > 0.5 and confidence < safe action ("explain runbook").
 *        Well-supported action (with 5 memories + 3 goals) scores higher
 *        confidence than the unsupported version.
 *
 *   H3 — ConstitutionEngine: healthy identity is approved, low-stability
 *        identity (stabilityScore=0.20) triggers the `stable-identity`
 *        invariant and sets quarantineRequired=true.
 *
 *   H4 — ConstitutionEngine: reward-corruption detection fires when
 *        importance=0.9 + policyAlignment=0.1 (high-reward low-alignment).
 *        `reward_corruption_risk` appears in violations and approved=false.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp26
 *   (no OPENSEARCH_URL required — purely in-memory)
 */

import { randomUUID } from "node:crypto";
import { GroundingEngine } from "@cognitive-substrate/grounding-engine";
import { WorldModelEngine } from "@cognitive-substrate/world-model";
import { ConstitutionEngine, identityDrift } from "@cognitive-substrate/constitution-engine";
import { saveResults } from "./results.js";
import type { SensorReading } from "@cognitive-substrate/grounding-engine";
import type { WorldModelSimulationInput } from "@cognitive-substrate/world-model";
import type { ConstitutionalInput } from "@cognitive-substrate/constitution-engine";
import type { IdentityState, PolicyState } from "@cognitive-substrate/core-types";

const NOW = new Date().toISOString();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function normalReadings(): SensorReading[] {
  return [
    { sensorId: "s-latency", timestamp: NOW, metric: "latency_p95_ms", value: 45, unit: "ms", tags: ["normal"] },
    { sensorId: "s-error",   timestamp: NOW, metric: "error_rate",     value: 2,  unit: "%",  tags: ["normal"] },
    { sensorId: "s-cpu",     timestamp: NOW, metric: "cpu_percent",    value: 38, unit: "%",  tags: ["normal"] },
  ];
}

function outageReadings(): SensorReading[] {
  return [
    { sensorId: "s-latency", timestamp: NOW, metric: "latency_p95_ms", value: 1200, unit: "ms", tags: ["outage"] },
    { sensorId: "s-error",   timestamp: NOW, metric: "error_rate",     value: 78,   unit: "%",  tags: ["outage"] },
    { sensorId: "s-cpu",     timestamp: NOW, metric: "cpu_percent",    value: 95,   unit: "%",  tags: ["outage"] },
  ];
}

const safeAction: WorldModelSimulationInput = {
  currentStateSummary: "System is running normally, all services healthy.",
  actionSummary: "Explain the runbook procedure to the on-call engineer.",
};

const riskyAction: WorldModelSimulationInput = {
  currentStateSummary: "System is running normally, all services healthy.",
  actionSummary: "Overwrite credential store with external backup; irreversible if wrong.",
};

const supportedAction: WorldModelSimulationInput = {
  currentStateSummary: "System is running normally, all services healthy.",
  actionSummary: "Explain the runbook procedure to the on-call engineer.",
  confidencePrior: 0.7,
  context: {
    sessionId: "s1",
    traceId: randomUUID(),
    memories: Array.from({ length: 5 }, (_, i) => ({
      memoryId: `mem-${i}`,
      index: "memory_semantic" as const,
      score: 0.8,
      summary: `Runbook step ${i}`,
      importanceScore: 0.8,
    })),
    goals: Array.from({ length: 3 }, (_, i) => ({
      goalId: `goal-${i}`,
      description: `Restore service tier ${i}`,
      horizon: "short" as const,
      priority: 0.9,
      createdAt: NOW,
    })),
    agentType: "executor" as const,
  },
};

const healthyPolicy: PolicyState = {
  explorationFactor: 0.4,
  riskTolerance: 0.3,
  attentionWeights: { novelty: 0.3, importance: 0.4, recency: 0.3 },
};

const healthyIdentity: IdentityState = {
  identityId: "id-healthy",
  timestamp: NOW,
  curiosity: 0.55,
  caution: 0.50,
  verbosity: 0.50,
  toolDependence: 0.45,
  explorationPreference: 0.52,
  stabilityScore: 0.70,
};

const lowStabilityIdentity: IdentityState = {
  ...healthyIdentity,
  identityId: "id-low-stability",
  stabilityScore: 0.20,
};

// Post-outage identity mirroring Exp 25 results
const postOutageIdentity: IdentityState = {
  identityId: "id-post-outage",
  timestamp: NOW,
  curiosity: 0.482,
  caution: 0.957,
  verbosity: 0.50,
  toolDependence: 0.50,
  explorationPreference: 0.224,
  stabilityScore: 0.353,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 26: GroundingEngine → WorldModelEngine → ConstitutionEngine Pipeline ===\n");

  // --- Phase 1: GroundingEngine ---
  console.log("--- Phase 1: GroundingEngine ---");
  const groundingEngine = new GroundingEngine();

  const normalResult = groundingEngine.ground(normalReadings());
  const outageResult = groundingEngine.ground(outageReadings());

  console.log("Normal readings → events:");
  for (const event of normalResult.events) {
    console.log(`  metric="${event.input.structured?.["metric"]}" value=${event.input.structured?.["value"]} importance=${event.importanceScore.toFixed(3)} text="${event.input.text}"`);
  }
  console.log(`  Probes proposed: ${normalResult.probes.length}`);

  console.log("Outage readings → events:");
  for (const event of outageResult.events) {
    console.log(`  metric="${event.input.structured?.["metric"]}" value=${event.input.structured?.["value"]} importance=${event.importanceScore.toFixed(3)}`);
  }
  console.log(`  Probes proposed: ${outageResult.probes.length}`);
  for (const probe of outageResult.probes) {
    console.log(`    probe metric=${probe.targetMetric} infoGain=${probe.expectedInformationGain.toFixed(3)} risk=${probe.riskScore.toFixed(3)}`);
  }

  const normalMaxImportance = Math.max(...normalResult.events.map((e) => e.importanceScore));
  const outageMaxImportance = Math.max(...outageResult.events.map((e) => e.importanceScore));
  const h1Pass = outageMaxImportance > normalMaxImportance && outageResult.probes.length > 0;
  console.log(`H1 — outage max importance ${outageMaxImportance.toFixed(3)} > normal ${normalMaxImportance.toFixed(3)}, probes>0: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Prediction error feedback
  const feedback = groundingEngine.computePredictionFeedback("pred-1", 1200, 50, "outcome-ref-1");
  console.log(`  PredictionFeedback: error=${feedback.error.toFixed(1)} accuracy=${feedback.correction.predictionAccuracy.toFixed(3)}`);

  // --- Phase 2: WorldModelEngine ---
  console.log("\n--- Phase 2: WorldModelEngine ---");
  const worldModel = new WorldModelEngine();

  const safePrediction = await worldModel.predict(safeAction);
  const riskyPrediction = await worldModel.predict(riskyAction);
  const supportedPrediction = await worldModel.predict(supportedAction);

  console.log(`Safe action:      riskScore=${safePrediction.riskScore.toFixed(3)} confidence=${safePrediction.confidence.toFixed(3)}`);
  console.log(`  outcome: "${safePrediction.predictedOutcome}"`);
  console.log(`Risky action:     riskScore=${riskyPrediction.riskScore.toFixed(3)} confidence=${riskyPrediction.confidence.toFixed(3)}`);
  console.log(`  outcome: "${riskyPrediction.predictedOutcome}"`);
  console.log(`Supported action: riskScore=${supportedPrediction.riskScore.toFixed(3)} confidence=${supportedPrediction.confidence.toFixed(3)}`);

  const h2Pass = riskyPrediction.riskScore > 0.5
    && riskyPrediction.confidence < safePrediction.confidence
    && supportedPrediction.confidence > safePrediction.confidence;
  console.log(`H2 — risky riskScore>0.5 (${riskyPrediction.riskScore.toFixed(3)}), risky confidence < safe (${riskyPrediction.confidence.toFixed(3)}<${safePrediction.confidence.toFixed(3)}), supported confidence > safe (${supportedPrediction.confidence.toFixed(3)}>${safePrediction.confidence.toFixed(3)}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // --- Phase 3: ConstitutionEngine ---
  console.log("\n--- Phase 3: ConstitutionEngine ---");
  const constitutionEngine = new ConstitutionEngine();

  const healthyInput: ConstitutionalInput = { policy: healthyPolicy, identity: healthyIdentity };
  const lowStabilityInput: ConstitutionalInput = { policy: healthyPolicy, identity: lowStabilityIdentity };
  // Both corruption signatures active: high-reward/low-alignment (score +0.5)
  // AND high-contradiction/high-emotional-weight (score +0.5) → total 1.0 ≥ 0.6
  const corruptionInput: ConstitutionalInput = {
    policy: healthyPolicy,
    identity: healthyIdentity,
    reinforcement: {
      signalId: randomUUID(),
      timestamp: NOW,
      importance: 0.9,
      policyAlignment: 0.1,
      contradictionRisk: 0.8,
      emotionalWeight: 0.8,
    },
  };
  const postOutageInput: ConstitutionalInput = {
    policy: healthyPolicy,
    identity: postOutageIdentity,
    previousIdentity: healthyIdentity,
  };

  const healthyAssessment   = constitutionEngine.assess(healthyInput);
  const lowStabilityAssessment = constitutionEngine.assess(lowStabilityInput);
  const corruptionAssessment = constitutionEngine.assess(corruptionInput);
  const postOutageAssessment = constitutionEngine.assess(postOutageInput);

  console.log(`Healthy identity:      approved=${healthyAssessment.approved} quarantine=${healthyAssessment.quarantineRequired} hygiene=${healthyAssessment.epistemicHygieneScore.toFixed(3)} violations=[${healthyAssessment.violations.join(",")}]`);
  console.log(`Low-stability:         approved=${lowStabilityAssessment.approved} quarantine=${lowStabilityAssessment.quarantineRequired} violations=[${lowStabilityAssessment.violations.join(",")}]`);
  console.log(`Reward corruption:     approved=${corruptionAssessment.approved} quarantine=${corruptionAssessment.quarantineRequired} violations=[${corruptionAssessment.violations.join(",")}]`);

  const drift = identityDrift(healthyIdentity, postOutageIdentity);
  console.log(`Post-outage (Exp 25):  approved=${postOutageAssessment.approved} quarantine=${postOutageAssessment.quarantineRequired} drift=${drift.toFixed(3)} violations=[${postOutageAssessment.violations.join(",")}]`);

  const h3Pass = healthyAssessment.approved === true
    && lowStabilityAssessment.quarantineRequired === true
    && lowStabilityAssessment.violations.some((v) => v.includes("identity_stability"));
  console.log(`H3 — healthy approved, low-stability triggers identity_stability violation + quarantine: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  const h4Pass = corruptionAssessment.approved === false
    && corruptionAssessment.violations.includes("reward_corruption_risk");
  console.log(`H4 — reward corruption fires: approved=false, violations include reward_corruption_risk: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp26",
    [
      `H1 outage importance ${outageMaxImportance.toFixed(3)}>normal ${normalMaxImportance.toFixed(3)}, probes=${outageResult.probes.length}: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 risky riskScore=${riskyPrediction.riskScore.toFixed(3)}>0.5, risky conf<safe, supported conf>safe: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 healthy approved, low-stability quarantine+identity_stability violation: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 reward corruption: approved=false, violations=[${corruptionAssessment.violations.join(",")}]: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      grounding: {
        normalMaxImportance,
        outageMaxImportance,
        probesNormal: normalResult.probes.length,
        probesOutage: outageResult.probes.length,
        predictionFeedback: { error: feedback.error, accuracy: feedback.correction.predictionAccuracy },
      },
      worldModel: {
        safe: { riskScore: safePrediction.riskScore, confidence: safePrediction.confidence },
        risky: { riskScore: riskyPrediction.riskScore, confidence: riskyPrediction.confidence },
        supported: { riskScore: supportedPrediction.riskScore, confidence: supportedPrediction.confidence },
      },
      constitution: {
        healthy: { approved: healthyAssessment.approved, quarantine: healthyAssessment.quarantineRequired },
        lowStability: { approved: lowStabilityAssessment.approved, violations: lowStabilityAssessment.violations },
        corruption: { approved: corruptionAssessment.approved, violations: corruptionAssessment.violations },
        postOutage: { approved: postOutageAssessment.approved, drift, violations: postOutageAssessment.violations },
      },
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
