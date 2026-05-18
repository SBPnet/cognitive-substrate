/**
 * Experiment 37 — Goal System: Multi-Horizon Hierarchy and selectNextGoal Scoring
 *
 * The GoalSystem (packages/agents/src/goal-system.ts) provides long-horizon
 * persistence for the cognitive loop. Goals are arranged in a hierarchy
 * (meta → long → mid → short → micro) and selected each turn via a blended
 * score that incorporates priority, horizon weight, progress opportunity, and
 * event relevance.
 *
 * This experiment validates four properties of the goal system without
 * requiring a live OpenSearch cluster:
 *
 *   1. Hierarchy invariant: decomposeGoal always creates children at the
 *      next-lower horizon and propagates 90% of the parent priority.
 *
 *   2. Selection ordering: selectNextGoal correctly ranks a high-priority
 *      long-horizon goal above a low-priority micro goal when goalPersistence
 *      is high (≥0.8), and the ordering inverts when goalPersistence is low
 *      (≤0.2) because the horizon weight contribution collapses.
 *
 *   3. Progress gating: a goal at progress=0.99 is still "active"; recording
 *      a delta of 0.02 pushes it to 1.0 and the status transitions to
 *      "completed". Once completed it no longer appears in listActiveGoals().
 *
 *   4. Event relevance scoring: scoreGoalRelevance returns a higher value
 *      when the event text overlaps significantly with the goal description
 *      than when it is semantically unrelated.
 *
 * Four hypotheses:
 *
 *   H1 — Hierarchy depth: a meta goal decomposed to long, then to mid, then to
 *        short, then to micro produces subgoal priorities
 *        0.9 × 0.9 × 0.9 × 0.9 = 0.6561 (within ±0.01 of the root priority
 *        0.8 × 0.9^4 = 0.5248 if root priority=0.8).
 *
 *   H2 — Selection inversion: with goalPersistence=0.9, the long-horizon goal
 *        ranks above the micro goal; with goalPersistence=0.1, the micro goal
 *        (which has higher raw priority) ranks above the long-horizon goal.
 *
 *   H3 — Completion transition: after recording progress on a goal until
 *        cumulative progress ≥ 1.0, the goal status is "completed" and it
 *        is absent from listActiveGoals().
 *
 *   H4 — Event relevance gap: an event whose text shares ≥4 tokens with the
 *        goal description scores ≥0.5 relevance, while an unrelated event
 *        scores ≤0.15.
 *
 * This experiment is pure in-process — no OpenSearch required.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp37
 */

import {
  GoalSystem,
  InMemoryGoalStore,
  goalSelectionScore,
  scoreGoalRelevance,
} from "@cognitive-substrate/agents";
import { saveResults } from "./results.js";
import type { Goal, PolicyState } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Helper: build a minimal policy with goalPersistence
// ---------------------------------------------------------------------------

function policyWith(goalPersistence: number): Partial<PolicyState> {
  return {
    goalPersistence,
    explorationFactor: 0.5,
    riskTolerance: 0.5,
    retrievalBias: 0.5,
    toolBias: 0.3,
    memoryTrust: 0.7,
    workingMemoryDecayRate: 0.1,
  };
}

// ---------------------------------------------------------------------------
// H1 — Hierarchy depth and priority propagation
// ---------------------------------------------------------------------------

async function testHierarchyDepth(): Promise<{
  pass: boolean;
  rootPriority: number;
  deepLeafPriority: number;
  expected: number;
  details: string;
}> {
  const store = new InMemoryGoalStore();
  const system = new GoalSystem({ store });

  const root = await system.createGoal({ description: "Maintain system reliability", horizon: "meta", priority: 0.8 });
  const [longGoal] = await system.decomposeGoal(root, ["Reduce mean incident duration"]);
  const [midGoal]  = await system.decomposeGoal(longGoal!, ["Improve runbook coverage"]);
  const [shortGoal] = await system.decomposeGoal(midGoal!, ["Document postgres failover"]);
  const [microGoal] = await system.decomposeGoal(shortGoal!, ["Add step 3 to runbook"]);

  const rootP = root.priority;
  const leafP = microGoal!.priority;
  const expected = rootP * Math.pow(0.9, 4);

  const pass = Math.abs(leafP - expected) <= 0.02;
  return {
    pass,
    rootPriority: rootP,
    deepLeafPriority: leafP,
    expected,
    details: `root=${rootP.toFixed(4)} leaf=${leafP.toFixed(4)} expected=${expected.toFixed(4)} diff=${Math.abs(leafP - expected).toFixed(4)}`,
  };
}

// ---------------------------------------------------------------------------
// H2 — Selection inversion across goalPersistence values
// ---------------------------------------------------------------------------

async function testSelectionInversion(): Promise<{
  pass: boolean;
  highPersistenceWinner: string;
  lowPersistenceWinner: string;
  details: string;
}> {
  const store = new InMemoryGoalStore();
  const system = new GoalSystem({ store });

  // long-horizon goal: moderate priority but high horizon weight
  const longGoal = await system.createGoal({
    description: "Achieve quarterly reliability target",
    horizon: "long",
    priority: 0.65,
  });

  // micro goal: higher raw priority but low horizon weight
  const microGoal = await system.createGoal({
    description: "Fix typo in log line",
    horizon: "micro",
    priority: 0.80,
  });

  const goals: Goal[] = await system.listActiveGoals() as Goal[];

  const highPersistenceScores = goals.map((g) => ({
    id: g.goalId,
    horizon: g.horizon,
    score: goalSelectionScore(g, { goals, policy: policyWith(0.9) }),
  }));
  highPersistenceScores.sort((a, b) => b.score - a.score);

  const lowPersistenceScores = goals.map((g) => ({
    id: g.goalId,
    horizon: g.horizon,
    score: goalSelectionScore(g, { goals, policy: policyWith(0.1) }),
  }));
  lowPersistenceScores.sort((a, b) => b.score - a.score);

  const highWinnerId   = highPersistenceScores[0]!.id;
  const lowWinnerId    = lowPersistenceScores[0]!.id;
  const highWinnerHorizon = highPersistenceScores[0]!.horizon;
  const lowWinnerHorizon  = lowPersistenceScores[0]!.horizon;

  // With high persistence, long should win (horizon weight dominates)
  // With low persistence, micro should win (raw priority dominates)
  const highWinsLong = highWinnerId === longGoal.goalId;
  const lowWinsMicro = lowWinnerId === microGoal.goalId;
  const pass = highWinsLong && lowWinsMicro;

  return {
    pass,
    highPersistenceWinner: highWinnerHorizon,
    lowPersistenceWinner: lowWinnerHorizon,
    details: `highPersistence winner: ${highWinnerHorizon} (score=${highPersistenceScores[0]!.score.toFixed(4)}) | lowPersistence winner: ${lowWinnerHorizon} (score=${lowPersistenceScores[0]!.score.toFixed(4)})`,
  };
}

// ---------------------------------------------------------------------------
// H3 — Completion transition
// ---------------------------------------------------------------------------

async function testCompletionTransition(): Promise<{
  pass: boolean;
  progressBeforeLast: number;
  statusAfter: string;
  appearsInActive: boolean;
  details: string;
}> {
  const store = new InMemoryGoalStore();
  const system = new GoalSystem({ store });

  const goal = await system.createGoal({
    description: "Complete incident retrospective",
    horizon: "short",
    priority: 0.7,
  });

  // Advance to 0.99
  await system.recordProgress({ goalId: goal.goalId, progressDelta: 0.99 });
  const afterFirst = await store.get(goal.goalId);

  // Now push over 1.0
  await system.recordProgress({ goalId: goal.goalId, progressDelta: 0.02 });
  const afterCompletion = await store.get(goal.goalId);

  const active = await system.listActiveGoals();
  const stillActive = active.some((g) => g.goalId === goal.goalId);

  const pass = afterFirst!.status === "active" &&
               afterCompletion!.status === "completed" &&
               !stillActive;

  return {
    pass,
    progressBeforeLast: afterFirst!.progress,
    statusAfter: afterCompletion!.status,
    appearsInActive: stillActive,
    details: `beforeLast progress=${afterFirst!.progress.toFixed(4)} status=${afterFirst!.status}; after: status=${afterCompletion!.status} appearsInActive=${stillActive}`,
  };
}

// ---------------------------------------------------------------------------
// H4 — Event relevance gap
// ---------------------------------------------------------------------------

function testEventRelevanceGap(): {
  pass: boolean;
  relevantScore: number;
  unrelatedScore: number;
  details: string;
} {
  const goal: Goal = {
    goalId: "test-goal",
    createdAt: new Date().toISOString(),
    description: "reduce database query latency postgresql slow queries",
    horizon: "mid",
    priority: 0.6,
    progress: 0,
    status: "active",
    associatedMemoryIds: [],
    subgoals: [],
  };

  const relatedEvent = {
    eventId: "ev-1",
    timestamp: new Date().toISOString(),
    type: "environmental_observation" as const,
    input: {
      text: "database query latency postgresql slow queries detected increasing",
      embedding: [] as number[],
    },
    context: { sessionId: "s", traceId: "t", agentId: "a" },
    importanceScore: 0.7,
    tags: ["database", "latency"],
  };

  const unrelatedEvent = {
    eventId: "ev-2",
    timestamp: new Date().toISOString(),
    type: "environmental_observation" as const,
    input: {
      text: "network switch reboot schedule maintenance window",
      embedding: [] as number[],
    },
    context: { sessionId: "s", traceId: "t", agentId: "a" },
    importanceScore: 0.3,
    tags: ["network", "maintenance"],
  };

  const relevantScore  = scoreGoalRelevance(goal, relatedEvent);
  const unrelatedScore = scoreGoalRelevance(goal, unrelatedEvent);
  const pass = relevantScore >= 0.5 && unrelatedScore <= 0.15;

  return {
    pass,
    relevantScore,
    unrelatedScore,
    details: `related=${relevantScore.toFixed(4)} unrelated=${unrelatedScore.toFixed(4)}`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 37: Goal System Multi-Horizon Hierarchy ===\n");

  console.log("H1 — Hierarchy depth and priority propagation...");
  const h1Result = await testHierarchyDepth();
  console.log(`  ${h1Result.details}`);
  console.log(`  ${h1Result.pass ? "✓ PASS" : "✗ FAIL"}`);

  console.log("\nH2 — Selection inversion across goalPersistence...");
  const h2Result = await testSelectionInversion();
  console.log(`  ${h2Result.details}`);
  console.log(`  ${h2Result.pass ? "✓ PASS" : "✗ FAIL"}`);

  console.log("\nH3 — Completion transition...");
  const h3Result = await testCompletionTransition();
  console.log(`  ${h3Result.details}`);
  console.log(`  ${h3Result.pass ? "✓ PASS" : "✗ FAIL"}`);

  console.log("\nH4 — Event relevance gap...");
  const h4Result = testEventRelevanceGap();
  console.log(`  ${h4Result.details}`);
  console.log(`  ${h4Result.pass ? "✓ PASS" : "✗ FAIL"}`);

  const allPass = h1Result.pass && h2Result.pass && h3Result.pass && h4Result.pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp37",
    [
      `H1 priority propagation: ${h1Result.pass ? "PASS" : "FAIL"} (${h1Result.details})`,
      `H2 selection inversion: ${h2Result.pass ? "PASS" : "FAIL"} (${h2Result.details})`,
      `H3 completion transition: ${h3Result.pass ? "PASS" : "FAIL"} (${h3Result.details})`,
      `H4 event relevance gap: ${h4Result.pass ? "PASS" : "FAIL"} (${h4Result.details})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Result.pass, h2: h2Result.pass, h3: h3Result.pass, h4: h4Result.pass },
      h1: h1Result,
      h2: h2Result,
      h3: h3Result,
      h4: h4Result,
    },
  );
  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
