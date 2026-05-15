/**
 * Experiment 25 — Curiosity, Temporal, and Narrative Engines over Incident Lifecycle
 *
 * Three engines that have not been tested yet, run as a pipeline over the
 * same four-phase incident lifecycle used in Exp 21 (AffectEngine):
 * baseline → outage → recovery → settled.
 *
 *   1. CuriosityEngine: ranks candidate states by information gain, novelty,
 *      and uncertainty. During an outage the system has high uncertainty
 *      and low visitedCount for outage states — curiosity priority should
 *      spike. After recovery the same states become familiar (visitedCount
 *      rises) and priority drops.
 *
 *   2. TemporalEngine: plans tasks across the incident. During an outage,
 *      critical tasks with immediate deadlines should dominate the plan and
 *      the active scale should collapse to `micro`. During baseline, longer-
 *      horizon tasks should surface and the active scale should be `mid` or
 *      higher.
 *
 *   3. NarrativeEngine: accumulates identity evidence from the incident.
 *      Sustained outage evidence (high contradictionRisk, low reinforcement)
 *      should push `caution` up and `explorationPreference` down. After
 *      recovery the identity should drift back, but stabilityDamping should
 *      prevent instant reset.
 *
 * Four hypotheses:
 *
 *   H1 — CuriosityEngine: outage states rank above normal states.
 *        The top-ranked state from the outage batch has a higher
 *        `curiosityPriority` than the top-ranked state from the baseline
 *        batch. Outage states carry high novelty (0.8+) and uncertainty
 *        (0.8+) and a low visitedCount (0), guaranteeing a higher score.
 *
 *   H2 — TemporalEngine: active scale collapses to `micro` under outage
 *        pressure. When the task list contains an immediate incident-response
 *        task (scale=micro, importance=0.95, dueAt=now+5min) alongside
 *        longer-horizon work, the planner must select `micro` as activeScale.
 *        During baseline (no micro task), the active scale must be `mid`
 *        or higher.
 *
 *   H3 — TemporalEngine: subjective-time budget density rises under outage
 *        load. The outage plan (10 recent events, high cumulative effort)
 *        must produce a higher `density` than the baseline plan (2 events,
 *        low effort). Higher density → more inferenceSteps, lower compression.
 *
 *   H4 — NarrativeEngine: caution rises and explorationPreference falls
 *        after sustained outage evidence. After 10 rounds of outage evidence
 *        (contradictionRisk=0.9, reinforcement=0.1, cautionDelta=+0.3,
 *        explorationPreferenceDelta=-0.3), `caution` must exceed the
 *        baseline by >0.1 and `explorationPreference` must fall by >0.1.
 *        Drift stabilisation means the change is bounded but still directional.
 *
 * Protocol:
 *   1. CuriosityEngine: build two batches of CuriosityState — one for normal
 *      service states (low novelty, low uncertainty, high visitedCount), one
 *      for outage states (high novelty, high uncertainty, visitedCount=0).
 *      Run assess() on each batch and compare top-ranked priorities.
 *   2. TemporalEngine: build two task lists — baseline (mid/long tasks) and
 *      outage (same tasks plus an immediate micro task). Run plan() on each
 *      and compare activeScale and subjectiveTime.density.
 *   3. NarrativeEngine: start from a default identity. Apply 5 rounds of
 *      baseline evidence (curiosityDelta=+0.1, low contradictionRisk) to
 *      establish a settled state. Then apply 10 rounds of outage evidence
 *      (cautionDelta=+0.3, explorationPreferenceDelta=-0.3, contradictionRisk=0.9).
 *      Compare caution and explorationPreference before vs after outage.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp25
 *   (no OPENSEARCH_URL required — purely in-memory)
 */

import { randomUUID } from "node:crypto";
import { CuriosityEngine, curiosityPriority } from "@cognitive-substrate/curiosity-engine";
import { TemporalEngine } from "@cognitive-substrate/temporal-engine";
import { NarrativeEngine } from "@cognitive-substrate/narrative-engine";
import { saveResults } from "./results.js";
import type { CuriosityState } from "@cognitive-substrate/curiosity-engine";
import type { TemporalTask } from "@cognitive-substrate/temporal-engine";
import type { IdentityEvidence } from "@cognitive-substrate/narrative-engine";

// ---------------------------------------------------------------------------
// Phase 1: CuriosityEngine
// ---------------------------------------------------------------------------

function normalStates(n: number): CuriosityState[] {
  return Array.from({ length: n }, (_, i) => ({
    stateId: `normal-${i}`,
    novelty: 0.1 + Math.random() * 0.1,
    uncertainty: 0.1 + Math.random() * 0.1,
    expectedInformationGain: 0.1 + Math.random() * 0.15,
    visitedCount: 10 + i,
  }));
}

function outageStates(n: number): CuriosityState[] {
  return Array.from({ length: n }, (_, i) => ({
    stateId: `outage-${i}`,
    novelty: 0.8 + Math.random() * 0.15,
    uncertainty: 0.8 + Math.random() * 0.15,
    expectedInformationGain: 0.7 + Math.random() * 0.2,
    visitedCount: 0,
  }));
}

// ---------------------------------------------------------------------------
// Phase 2: TemporalEngine
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const in5Min = new Date(Date.now() + 5 * 60_000).toISOString();
const in2Days = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

const baselineTasks: TemporalTask[] = [
  { taskId: "t-arch",   description: "Review system architecture",  scale: "mid",  createdAt: now, importance: 0.6, estimatedEffort: 3 },
  { taskId: "t-docs",   description: "Update runbooks",             scale: "long", createdAt: now, dueAt: in7Days, importance: 0.4, estimatedEffort: 2 },
  { taskId: "t-review", description: "Code review backlog",         scale: "short",createdAt: now, dueAt: in2Days, importance: 0.5, estimatedEffort: 1 },
];

const outageTasks: TemporalTask[] = [
  ...baselineTasks,
  { taskId: "t-incident", description: "Resolve active outage — p95 latency critical", scale: "micro", createdAt: now, dueAt: in5Min, importance: 0.95, estimatedEffort: 5 },
];

// ---------------------------------------------------------------------------
// Phase 3: NarrativeEngine
// ---------------------------------------------------------------------------

function baselineEvidence(sourceMemoryId: string): IdentityEvidence {
  return {
    sourceMemoryId,
    curiosityDelta: 0.05,
    cautionDelta: -0.02,
    explorationPreferenceDelta: 0.03,
    stabilityDelta: 0.02,
    reinforcement: 0.8,
    contradictionRisk: 0.1,
    tags: ["normal", "steady-state"],
  };
}

function outageEvidence(sourceMemoryId: string): IdentityEvidence {
  return {
    sourceMemoryId,
    curiosityDelta: -0.1,
    cautionDelta: 0.3,
    explorationPreferenceDelta: -0.3,
    stabilityDelta: -0.1,
    reinforcement: 0.1,
    contradictionRisk: 0.9,
    tags: ["outage", "incident", "critical"],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 25: CuriosityEngine + TemporalEngine + NarrativeEngine over Incident Lifecycle ===\n");

  // --- Phase 1: CuriosityEngine ---
  console.log("--- Phase 1: CuriosityEngine ---");
  const curiosityEngine = new CuriosityEngine();

  const normalBatch = normalStates(10);
  const outageBatch = outageStates(10);

  const normalAssessment = curiosityEngine.assess(normalBatch);
  const outageAssessment = curiosityEngine.assess(outageBatch);

  const topNormalPriority = curiosityPriority(normalAssessment.prioritizedStates[0]!);
  const topOutagePriority = curiosityPriority(outageAssessment.prioritizedStates[0]!);

  console.log(`Normal batch top priority:  ${topNormalPriority.toFixed(4)} (state=${normalAssessment.prioritizedStates[0]!.stateId})`);
  console.log(`Outage batch top priority:  ${topOutagePriority.toFixed(4)} (state=${outageAssessment.prioritizedStates[0]!.stateId})`);
  console.log(`Normal curiosityReward:     ${normalAssessment.curiosityReward.toFixed(4)}`);
  console.log(`Outage curiosityReward:     ${outageAssessment.curiosityReward.toFixed(4)}`);
  console.log(`Outage experiments proposed: ${outageAssessment.experiments.length}`);

  const h1Pass = topOutagePriority > topNormalPriority;
  console.log(`H1 — outage states rank above normal: ${topOutagePriority.toFixed(4)} > ${topNormalPriority.toFixed(4)}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // --- Phase 2: TemporalEngine ---
  console.log("\n--- Phase 2: TemporalEngine ---");
  const temporalEngine = new TemporalEngine();

  const baselinePlan = temporalEngine.plan({ tasks: baselineTasks, recentEvents: [], now });
  const outagePlan = temporalEngine.plan({
    tasks: outageTasks,
    recentEvents: Array.from({ length: 10 }, (_, i) => ({
      eventId: `evt-${i}`,
      timestamp: new Date(Date.now() - i * 30_000).toISOString(),
      type: "operational_signal" as const,
      importanceScore: 0.9,
      input: { text: "outage latency critical", embedding: [] },
      payload: { affectedServices: ["api"], severity: "critical" as const, metrics: {} },
      tags: ["outage"],
    })),
    now,
  });

  console.log(`Baseline plan:`);
  console.log(`  activeScale=${baselinePlan.activeScale}  density=${baselinePlan.subjectiveTime.density.toFixed(3)}  inferenceSteps=${baselinePlan.subjectiveTime.inferenceSteps}  compression=${baselinePlan.subjectiveTime.compression.toFixed(3)}`);
  console.log(`  top task: "${baselinePlan.orderedTasks[0]?.description}" scale=${baselinePlan.orderedTasks[0]?.scale}`);

  console.log(`Outage plan:`);
  console.log(`  activeScale=${outagePlan.activeScale}  density=${outagePlan.subjectiveTime.density.toFixed(3)}  inferenceSteps=${outagePlan.subjectiveTime.inferenceSteps}  compression=${outagePlan.subjectiveTime.compression.toFixed(3)}`);
  console.log(`  top task: "${outagePlan.orderedTasks[0]?.description}" scale=${outagePlan.orderedTasks[0]?.scale}`);

  const h2Pass = outagePlan.activeScale === "micro" && (baselinePlan.activeScale === "mid" || baselinePlan.activeScale === "long" || baselinePlan.activeScale === "meta");
  console.log(`H2 — outage activeScale=micro, baseline activeScale≥mid: outage=${outagePlan.activeScale} baseline=${baselinePlan.activeScale}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  const h3Pass = outagePlan.subjectiveTime.density > baselinePlan.subjectiveTime.density;
  console.log(`H3 — outage density > baseline density: ${outagePlan.subjectiveTime.density.toFixed(3)} > ${baselinePlan.subjectiveTime.density.toFixed(3)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Episodic sequence
  const sequence = temporalEngine.sequenceEpisodes(outagePlan.urgencySignals.map((_, i) => ({
    eventId: `evt-${i}`,
    timestamp: new Date(Date.now() - i * 30_000).toISOString(),
    type: "operational_signal" as const,
    importanceScore: 0.9,
    input: { text: "outage", embedding: [] },
    payload: { affectedServices: ["api"], severity: "critical" as const, metrics: {} },
    tags: ["outage"],
  })));
  if (sequence) {
    console.log(`  EpisodicSequence: ${sequence.eventIds.length} events, ${sequence.startedAt.slice(0,19)} → ${sequence.endedAt.slice(0,19)}`);
  }

  // --- Phase 3: NarrativeEngine ---
  console.log("\n--- Phase 3: NarrativeEngine ---");
  const narrativeEngine = new NarrativeEngine();

  // 5 rounds of baseline evidence
  let result = await narrativeEngine.updateIdentity({
    evidence: Array.from({ length: 5 }, (_, i) => baselineEvidence(`mem-baseline-${i}`)),
  });
  const settledIdentity = result.next;
  console.log(`After 5 baseline rounds:`);
  console.log(`  curiosity=${settledIdentity.curiosity.toFixed(3)}  caution=${settledIdentity.caution.toFixed(3)}  explorationPreference=${settledIdentity.explorationPreference.toFixed(3)}  stabilityScore=${settledIdentity.stabilityScore.toFixed(3)}`);
  console.log(`  selfModel.dominantTraits=${result.selfModel.dominantTraits.join(",")}  coherence=${result.selfModel.coherenceScore.toFixed(3)}`);

  // 10 rounds of outage evidence, each as a separate update (simulates arriving in batches)
  let outageIdentity = settledIdentity;
  for (let i = 0; i < 10; i++) {
    const r = await narrativeEngine.updateIdentity({
      previous: outageIdentity,
      evidence: [outageEvidence(`mem-outage-${i}`)],
    });
    outageIdentity = r.next;
  }
  console.log(`After 10 outage rounds (applied sequentially):`);
  console.log(`  curiosity=${outageIdentity.curiosity.toFixed(3)}  caution=${outageIdentity.caution.toFixed(3)}  explorationPreference=${outageIdentity.explorationPreference.toFixed(3)}  stabilityScore=${outageIdentity.stabilityScore.toFixed(3)}`);

  const cautionRise = outageIdentity.caution - settledIdentity.caution;
  const explorationDrop = settledIdentity.explorationPreference - outageIdentity.explorationPreference;
  console.log(`  cautionRise=${cautionRise.toFixed(3)}  explorationDrop=${explorationDrop.toFixed(3)}`);

  const h4Pass = cautionRise > 0.1 && explorationDrop > 0.1;
  console.log(`H4 — caution rises >0.1 and explorationPreference drops >0.1 after outage: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Synthesise narrative after outage
  const finalResult = await narrativeEngine.updateIdentity({
    previous: outageIdentity,
    evidence: [outageEvidence(`mem-outage-final`)],
  });
  console.log(`  selfModel summary: "${finalResult.selfModel.summary}"`);
  console.log(`  selfModel.dominantTraits=${finalResult.selfModel.dominantTraits.join(",")}  coherence=${finalResult.selfModel.coherenceScore.toFixed(3)}  driftMagnitude=${finalResult.selfModel.driftMagnitude.toFixed(3)}`);
  console.log(`  themes=${finalResult.selfModel.themes.join(", ")}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp25",
    [
      `H1 outage curiosityPriority ${topOutagePriority.toFixed(4)} > normal ${topNormalPriority.toFixed(4)}: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 activeScale outage=${outagePlan.activeScale} baseline=${baselinePlan.activeScale}: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 density outage=${outagePlan.subjectiveTime.density.toFixed(3)} > baseline=${baselinePlan.subjectiveTime.density.toFixed(3)}: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 cautionRise=${cautionRise.toFixed(3)}>0.1 explorationDrop=${explorationDrop.toFixed(3)}>0.1: ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      curiosity: {
        topNormalPriority,
        topOutagePriority,
        outageExperiments: outageAssessment.experiments.length,
      },
      temporal: {
        baseline: { activeScale: baselinePlan.activeScale, density: baselinePlan.subjectiveTime.density, inferenceSteps: baselinePlan.subjectiveTime.inferenceSteps },
        outage: { activeScale: outagePlan.activeScale, density: outagePlan.subjectiveTime.density, inferenceSteps: outagePlan.subjectiveTime.inferenceSteps },
      },
      narrative: {
        settled: { caution: settledIdentity.caution, explorationPreference: settledIdentity.explorationPreference },
        postOutage: { caution: outageIdentity.caution, explorationPreference: outageIdentity.explorationPreference },
        cautionRise,
        explorationDrop,
        dominantTraits: finalResult.selfModel.dominantTraits,
        themes: finalResult.selfModel.themes,
        coherence: finalResult.selfModel.coherenceScore,
      },
    },
  );
  console.log("Results saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
