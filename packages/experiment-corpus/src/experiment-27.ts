/**
 * Experiment 27 — BudgetEngine, DevelopmentEngine, DreamEngine, MetacogEngine, SocialEngine
 *
 * The final five untested engines, all pure in-memory. Run as a single
 * experiment to complete coverage of all cognitive-substrate packages.
 *
 *   1. BudgetEngine: enforces compute quotas. Tests approval, exhaustion-based
 *      rejection, and the fast/slow mode switch.
 *
 *   2. DevelopmentEngine: maps mean capability score to a phase and unlocks
 *      subsystems. Tests phase transitions across the full ladder.
 *
 *   3. DreamEngine: pairs adjacent memories and synthesises replay scenarios.
 *      Tests that high-contradiction memories produce high-stress scenarios
 *      and that the synthetic events carry the correct tags.
 *
 *   4. MetacogEngine (CalibrationMonitor + ReflectionEngine): evaluates how
 *      well stated confidence matched outcomes, attributes failures, and
 *      proposes self-modification when calibration error is high.
 *
 *   5. SocialEngine: builds a user model from experience events. Tests trust
 *      accumulation from successful events and deception-risk detection from
 *      contradiction-laden text.
 *
 * Four hypotheses:
 *
 *   H1 — BudgetEngine: a high-utility request is approved with `slow` mode;
 *        after exhausting the token quota a subsequent request is rejected
 *        with reason `cognitive_exhaustion` or `quota_exceeded`.
 *
 *   H2 — DevelopmentEngine: capabilities at mean=0.30 → phase=`novice`;
 *        capabilities at mean=0.75 → phase=`integrative`; phase transition
 *        is detected and additional subsystems are unlocked.
 *
 *   H3 — DreamEngine: memory pairs with high contradictionScore produce
 *        scenarios with stressScore > 0.5; synthetic events carry the
 *        `dream` and `synthetic-replay` tags.
 *
 *   H4 — MetacogEngine: when a trace reports confidence=0.9 but
 *        succeeded=false, calibrationError > 0.5 and a self-modification
 *        proposal is emitted. SocialEngine: after 5 successful events the
 *        trustScore rises above 0.5; after deception-laden events
 *        deceptionRisk rises from the prior.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp27
 *   (no OPENSEARCH_URL required — purely in-memory)
 */

import { randomUUID } from "node:crypto";
import { BudgetEngine } from "@cognitive-substrate/budget-engine";
import { DevelopmentEngine } from "@cognitive-substrate/development-engine";
import { DreamEngine } from "@cognitive-substrate/dream-engine";
import { CalibrationMonitor, ReflectionEngine } from "@cognitive-substrate/metacog-engine";
import { SocialEngine } from "@cognitive-substrate/social-engine";
import { saveResults } from "./results.js";
import type { CapabilityMetric, CurriculumItem } from "@cognitive-substrate/development-engine";
import type { SemanticMemory } from "@cognitive-substrate/core-types";
import type { CognitiveOperationTrace } from "@cognitive-substrate/metacog-engine";

const NOW = new Date().toISOString();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMemory(
  id: string,
  summary: string,
  contradictionScore: number,
  stabilityScore: number,
): SemanticMemory {
  return {
    memoryId: id,
    index: "memory_semantic",
    generalization: summary,
    summary,
    importanceScore: 0.7,
    contradictionScore,
    stabilityScore,
    retrievalCount: 2,
    embedding: [],
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeExperienceEvent(text: string, success?: boolean) {
  return {
    eventId: randomUUID(),
    timestamp: NOW,
    type: "operational_signal" as const,
    importanceScore: 0.7,
    input: { text, embedding: [] },
    payload: { affectedServices: ["api"], severity: "low" as const, metrics: {} },
    tags: ["social-test"],
    ...(success !== undefined ? { result: { success, latencyMs: 100 } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 27: BudgetEngine + DevelopmentEngine + DreamEngine + MetacogEngine + SocialEngine ===\n");

  // --- Phase 1: BudgetEngine ---
  console.log("--- Phase 1: BudgetEngine ---");
  const budgetEngine = new BudgetEngine({
    quotas: [{
      agentType: "executor",
      maxTokens: 1000,
      maxToolCalls: 5,
      maxLatencyMs: 10_000,
      resetIntervalMs: 60_000,
    }],
    utilityThreshold: 0.35,
  });

  // High-utility request
  const highUtilityDecision = budgetEngine.decide({
    agentType: "executor",
    expectedUtility: 0.9,
    expectedCost: 0.1,
    uncertainty: 0.4,
    requestedTokens: 200,
    requestedToolCalls: 2,
  });
  console.log(`High-utility:  approved=${highUtilityDecision.approved} mode=${highUtilityDecision.mode} utility=${highUtilityDecision.utility.toFixed(3)} reason=${highUtilityDecision.reason}`);

  // Exhaust the token quota
  budgetEngine.recordSpend("executor", 900, 1, 500);
  const exhaustedDecision = budgetEngine.decide({
    agentType: "executor",
    expectedUtility: 0.9,
    expectedCost: 0.1,
    requestedTokens: 200,
    requestedToolCalls: 1,
  });
  console.log(`After exhaust: approved=${exhaustedDecision.approved} mode=${exhaustedDecision.mode} reason=${exhaustedDecision.reason} exhaustion=${exhaustedDecision.exhaustion.toFixed(3)}`);

  // Low-utility request (below threshold)
  budgetEngine.reset("executor");
  const lowUtilityDecision = budgetEngine.decide({
    agentType: "executor",
    expectedUtility: 0.2,
    expectedCost: 0.05,
    requestedTokens: 50,
    requestedToolCalls: 0,
  });
  console.log(`Low-utility:   approved=${lowUtilityDecision.approved} mode=${lowUtilityDecision.mode} reason=${lowUtilityDecision.reason}`);

  const h1Pass = highUtilityDecision.approved && highUtilityDecision.mode === "slow"
    && !exhaustedDecision.approved
    && (exhaustedDecision.reason === "cognitive_exhaustion" || exhaustedDecision.reason === "quota_exceeded");
  console.log(`H1 — high-utility approved/slow, exhausted rejected: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // --- Phase 2: DevelopmentEngine ---
  console.log("\n--- Phase 2: DevelopmentEngine ---");
  const developmentEngine = new DevelopmentEngine();

  const noviceCapabilities: CapabilityMetric[] = [
    { capabilityId: "retrieval",    score: 0.35, evidenceCount: 10 },
    { capabilityId: "consolidation",score: 0.28, evidenceCount: 5  },
    { capabilityId: "policy",       score: 0.27, evidenceCount: 4  },
  ];

  const integrativeCapabilities: CapabilityMetric[] = noviceCapabilities.map((c) => ({
    ...c,
    score: c.score + 0.45,
  }));

  const curriculum: CurriculumItem[] = [
    { itemId: "c1", capabilityId: "retrieval",     difficulty: 0.4, expectedGain: 0.3 },
    { itemId: "c2", capabilityId: "consolidation", difficulty: 0.3, expectedGain: 0.4 },
    { itemId: "c3", capabilityId: "policy",        difficulty: 0.6, expectedGain: 0.5 },
    { itemId: "c4", capabilityId: "attention",     difficulty: 0.7, expectedGain: 0.6 },
    { itemId: "c5", capabilityId: "affect",        difficulty: 0.8, expectedGain: 0.7 },
    { itemId: "c6", capabilityId: "world-model",   difficulty: 0.5, expectedGain: 0.4 },
  ];

  const noviceState = { phase: "seed" as const, unlockedSubsystems: [], capabilities: noviceCapabilities };
  const noviceAssessment = developmentEngine.assess(noviceState, curriculum);

  const integrativeState = { phase: "novice" as const, unlockedSubsystems: noviceAssessment.state.unlockedSubsystems, capabilities: integrativeCapabilities };
  const integrativeAssessment = developmentEngine.assess(integrativeState, curriculum);

  console.log(`Novice caps (mean=${(noviceCapabilities.reduce((s, c) => s + c.score, 0) / noviceCapabilities.length).toFixed(2)}): phase=${noviceAssessment.state.phase} transitionDetected=${noviceAssessment.phaseTransitionDetected}`);
  console.log(`  unlocked: [${noviceAssessment.state.unlockedSubsystems.join(", ")}]`);
  console.log(`  top curriculum: ${noviceAssessment.selectedCurriculum.map((c) => c.itemId).join(", ")}`);
  console.log(`Integrative caps (mean=${(integrativeCapabilities.reduce((s, c) => s + c.score, 0) / integrativeCapabilities.length).toFixed(2)}): phase=${integrativeAssessment.state.phase} transitionDetected=${integrativeAssessment.phaseTransitionDetected}`);
  console.log(`  unlocked: [${integrativeAssessment.state.unlockedSubsystems.join(", ")}]`);

  const h2Pass = noviceAssessment.state.phase === "novice"
    && integrativeAssessment.state.phase === "integrative"
    && integrativeAssessment.phaseTransitionDetected
    && integrativeAssessment.state.unlockedSubsystems.length > noviceAssessment.state.unlockedSubsystems.length;
  console.log(`H2 — novice→integrative phase transition detected, subsystems unlocked: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // --- Phase 3: DreamEngine ---
  console.log("\n--- Phase 3: DreamEngine ---");
  const dreamEngine = new DreamEngine();

  const memories: SemanticMemory[] = [
    makeMemory("m1", "Service outage: p95 latency exceeded 2s threshold", 0.85, 0.30),
    makeMemory("m2", "Database writes failing with timeout errors",       0.80, 0.35),
    makeMemory("m3", "Normal baseline: all metrics within bounds",        0.05, 0.90),
    makeMemory("m4", "Cache hit rate stable at 94%",                      0.03, 0.92),
  ];

  const dreamResult = dreamEngine.runCycle({ memories, maxScenarios: 2 });

  console.log(`Dream scenarios: ${dreamResult.scenarios.length}`);
  for (const scenario of dreamResult.scenarios) {
    console.log(`  scenario=${scenario.scenarioId.slice(0, 8)} adversarialPressure=${scenario.adversarialPressure.toFixed(3)} stressScore=${scenario.stressScore.toFixed(3)}`);
    console.log(`    event tags=[${scenario.syntheticEvent.tags.join(",")}] importance=${scenario.syntheticEvent.importanceScore.toFixed(3)}`);
  }
  console.log(`Stress failures (stressScore>0.7): ${dreamResult.stressFailures.length}`);
  console.log(`Recombined abstractions: ${dreamResult.recombinedAbstractions.length}`);

  const highStressScenario = dreamResult.scenarios[0];
  const lowStressScenario = dreamResult.scenarios[1];
  const h3Pass = (highStressScenario?.stressScore ?? 0) > 0.5
    && highStressScenario?.syntheticEvent.tags.includes("dream") === true
    && highStressScenario?.syntheticEvent.tags.includes("synthetic-replay") === true
    && (lowStressScenario?.stressScore ?? 1) < (highStressScenario?.stressScore ?? 0);
  console.log(`H3 — high-contradiction scenario stressScore>0.5 with dream+synthetic-replay tags, stress[0]>stress[1]: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // --- Phase 4: MetacogEngine + SocialEngine ---
  console.log("\n--- Phase 4: MetacogEngine ---");
  const calibrationMonitor = new CalibrationMonitor();
  const reflectionEngine = new ReflectionEngine();

  const traces: CognitiveOperationTrace[] = [
    { operationId: "op-1", operationType: "retrieval",    confidence: 0.9,  succeeded: false, riskScore: 0.2,  latencyMs: 100 },
    { operationId: "op-2", operationType: "planning",     confidence: 0.7,  succeeded: true,  riskScore: 0.15, latencyMs: 200 },
    { operationId: "op-3", operationType: "tool_call",    confidence: 0.85, succeeded: false, riskScore: 0.75, latencyMs: 500 },
  ];

  const calibrationReport = calibrationMonitor.evaluate(traces);
  console.log(`Calibration meanError=${calibrationReport.meanCalibrationError.toFixed(3)} failureAttributions=[${calibrationReport.failureAttributions.join(", ")}]`);
  console.log(`Watchdog alerts: [${calibrationReport.watchdogAlerts.join(", ") || "none"}]`);
  for (const record of calibrationReport.records) {
    console.log(`  ${record.operationType}: confidence=${record.confidence.toFixed(3)} success=${record.observedSuccess} error=${record.calibrationError.toFixed(3)}`);
  }

  // Reflection over a failed high-risk action
  const reflectionInput = {
    loopResult: {
      actionResult: { success: false, latencyMs: 300 },
      agentResult: { confidence: 0.9, riskScore: 0.8 },
      context: {
        sessionId: "s1",
        traceId: randomUUID(),
        memories: [],
        goals: [],
        agentType: "executor" as const,
      },
    },
    priorReflectionsInSession: 0,
  };
  const reflectionResult = await reflectionEngine.reflect(reflectionInput);
  console.log(`Reflection: calibrationError=${reflectionResult.calibrationError.toFixed(3)} failureAttribution=${reflectionResult.failureAttribution}`);
  console.log(`  strategy: "${reflectionResult.strategyReflection}"`);
  console.log(`  proposal emitted: ${reflectionResult.proposal !== undefined}`);

  console.log("\n--- Phase 4: SocialEngine ---");
  const socialEngine = new SocialEngine();

  // 5 successful cooperative events
  const successEvents = Array.from({ length: 5 }, (_, i) =>
    makeExperienceEvent(`implement the fix for issue ${i}`, true),
  );
  const successAssessment = socialEngine.assess({ subjectId: "user-1", events: successEvents });

  // 3 deception-laden events
  const deceptionEvents = Array.from({ length: 3 }, (_, i) =>
    makeExperienceEvent(`contradict the previous claim and mislead about issue ${i}`),
  );
  const deceptionAssessment = socialEngine.assess({
    subjectId: "user-1",
    events: deceptionEvents,
    previous: successAssessment.userModel,
  });

  console.log(`After 5 successful events: trustScore=${successAssessment.userModel.trustScore.toFixed(3)} cooperationSignal=${successAssessment.cooperationSignal.toFixed(3)} intent=${successAssessment.intent.intent}`);
  console.log(`After 3 deception events:  trustScore=${deceptionAssessment.userModel.trustScore.toFixed(3)} deceptionRisk=${deceptionAssessment.userModel.deceptionRisk.toFixed(3)} (prior=0.1)`);

  const highCalibrationError = calibrationReport.records.find((r) => r.operationType === "retrieval")?.calibrationError ?? 0;
  const h4Pass = highCalibrationError > 0.5
    && reflectionResult.proposal !== undefined
    && successAssessment.userModel.trustScore > 0.5
    && deceptionAssessment.userModel.deceptionRisk > 0.1;
  console.log(`H4 — calibration error>0.5 (${highCalibrationError.toFixed(3)}), proposal emitted, trustScore>0.5 (${successAssessment.userModel.trustScore.toFixed(3)}), deceptionRisk>0.1 (${deceptionAssessment.userModel.deceptionRisk.toFixed(3)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp27",
    [
      `H1 budget approved/slow then rejected (${exhaustedDecision.reason}): ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 novice→integrative phase transition, subsystems unlocked: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 dream stress[0]=${dreamResult.scenarios[0]?.stressScore.toFixed(3)}>0.5 with dream tags: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 calibrationError=${highCalibrationError.toFixed(3)}>0.5 proposal emitted, trust/deception correct: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      budget: {
        highUtility: { approved: highUtilityDecision.approved, mode: highUtilityDecision.mode },
        exhausted: { approved: exhaustedDecision.approved, reason: exhaustedDecision.reason, exhaustion: exhaustedDecision.exhaustion },
        lowUtility: { approved: lowUtilityDecision.approved, reason: lowUtilityDecision.reason },
      },
      development: {
        novicePhase: noviceAssessment.state.phase,
        integrativePhase: integrativeAssessment.state.phase,
        transitionDetected: integrativeAssessment.phaseTransitionDetected,
        noviceUnlocked: noviceAssessment.state.unlockedSubsystems,
        integrativeUnlocked: integrativeAssessment.state.unlockedSubsystems,
      },
      dream: {
        scenarios: dreamResult.scenarios.map((s) => ({ stressScore: s.stressScore, adversarialPressure: s.adversarialPressure })),
        stressFailures: dreamResult.stressFailures.length,
      },
      metacog: {
        meanCalibrationError: calibrationReport.meanCalibrationError,
        watchdogAlerts: calibrationReport.watchdogAlerts,
        reflectionCalibrationError: reflectionResult.calibrationError,
        proposalEmitted: reflectionResult.proposal !== undefined,
        failureAttribution: reflectionResult.failureAttribution,
      },
      social: {
        afterSuccess: { trustScore: successAssessment.userModel.trustScore, intent: successAssessment.intent.intent },
        afterDeception: { trustScore: deceptionAssessment.userModel.trustScore, deceptionRisk: deceptionAssessment.userModel.deceptionRisk },
      },
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
