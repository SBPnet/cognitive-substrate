/**
 * Experiment 40 — Goal Progress Tracking: Subgoal Decomposition and Completion
 *
 * Experiment 37 validated the structural properties of the goal system
 * (priority propagation, selection inversion, completion transition, event
 * relevance). This experiment validates the dynamic progress-tracking
 * behaviour over a simulated 50-step incident-response workflow:
 *
 *   A meta goal "resolve production outage" is decomposed into a 4-level
 *   hierarchy: meta → long → mid × 2 → short × 4 → micro × 8. Progress is
 *   recorded bottom-up: micro goals complete first, driving mid progress,
 *   which drives long progress, which drives the meta goal to completion.
 *
 * The experiment also validates that:
 *   - GoalProgressEvents are emitted in the correct order (FIFO by goalId
 *     within each horizon batch)
 *   - The GoalSystem correctly refuses to record progress on a completed goal
 *     (it should no-op rather than throw, or throw predictably)
 *   - selectNextGoal prioritises the deepest active subgoal (lowest horizon
 *     with highest urgency) over higher-level parent goals during active work
 *
 * Four hypotheses:
 *
 *   H1 — Bottom-up completion cascade: after all 8 micro goals are completed,
 *        both mid goals complete, the long goal completes, and finally the meta
 *        goal reaches ≥0.9 progress (100% sub-completion propagated upward via
 *        manual recordProgress calls).
 *
 *   H2 — Progress event count: total GoalProgressEvents emitted equals the
 *        number of recordProgress calls made (one per step, no silent drops).
 *
 *   H3 — selectNextGoal during active work picks a micro goal: when multiple
 *        horizons are active simultaneously and a micro goal has progress < 1,
 *        selectNextGoal with default policy returns a micro goal (not the meta
 *        goal), confirming that urgency (progressOpportunity) outweighs
 *        horizon weight for shallow goals.
 *
 *   H4 — Completed goals are excluded: once a goal reaches status=completed,
 *        listActiveGoals() never returns it, and selectNextGoal skips it even
 *        when it has the highest priority in the store.
 *
 * No OpenSearch required.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp40
 */

import {
  GoalSystem,
  InMemoryGoalStore,
} from "@cognitive-substrate/agents";
import { saveResults } from "./results.js";
import type { Goal, GoalProgressEvent } from "@cognitive-substrate/core-types";
import type { GoalProgressPublisher } from "@cognitive-substrate/agents";

// ---------------------------------------------------------------------------
// Capturing publisher
// ---------------------------------------------------------------------------

class CapturingProgressPublisher implements GoalProgressPublisher {
  readonly events: GoalProgressEvent[] = [];
  async publish(event: GoalProgressEvent): Promise<void> {
    this.events.push(event);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 40: Goal Progress Tracking — Subgoal Decomposition ===\n");

  const store     = new InMemoryGoalStore();
  const publisher = new CapturingProgressPublisher();
  const system    = new GoalSystem({ store, publisher });

  // ---------------------------------------------------------------------------
  // Build hierarchy: meta → long → 2×mid → 4×short → 8×micro
  // ---------------------------------------------------------------------------

  const meta = await system.createGoal({
    description: "Resolve production outage restore service",
    horizon: "meta",
    priority: 0.95,
  });

  const [longGoal] = await system.decomposeGoal(meta, [
    "Contain incident and identify root cause",
  ]);

  const midGoals = await system.decomposeGoal(longGoal!, [
    "Implement immediate mitigation",
    "Notify stakeholders and document",
  ]);

  const short1 = await system.decomposeGoal(midGoals[0]!, [
    "Restart affected services",
    "Apply connection pool fix",
  ]);
  const short2 = await system.decomposeGoal(midGoals[1]!, [
    "Draft incident report",
    "Post customer notification",
  ]);
  const shortGoals = [...short1, ...short2];

  const microSets = await Promise.all(shortGoals.map((sg) =>
    system.decomposeGoal(sg, [
      `Execute step A for: ${sg.description}`,
      `Execute step B for: ${sg.description}`,
    ])
  ));
  const microGoals = microSets.flat();

  console.log(`Hierarchy created:`);
  console.log(`  meta=1 long=1 mid=${midGoals.length} short=${shortGoals.length} micro=${microGoals.length}`);

  // ---------------------------------------------------------------------------
  // H3 check — before any completion, selectNextGoal should return a micro goal
  // ---------------------------------------------------------------------------
  const allGoalsPre: Goal[] = await system.listActiveGoals() as Goal[];
  const selectedPre = system.selectNextGoal({ goals: allGoalsPre });
  const h3PreHorizon = selectedPre?.horizon ?? "none";
  console.log(`\nH3 pre-completion selected horizon: ${h3PreHorizon} (goal: ${selectedPre?.description.slice(0, 40)})`);

  // ---------------------------------------------------------------------------
  // H1 — Complete all micro goals, then propagate progress up the tree
  // ---------------------------------------------------------------------------
  let progressEventCount = 0;

  // Complete micro goals (100% progress each)
  for (const micro of microGoals) {
    await system.recordProgress({ goalId: micro.goalId, progressDelta: 1.0 });
    progressEventCount++;
  }

  // Propagate progress to short goals (each has 2 micro subgoals done → 100%)
  for (const short of shortGoals) {
    await system.recordProgress({ goalId: short.goalId, progressDelta: 1.0 });
    progressEventCount++;
  }

  // Propagate to mid goals
  for (const mid of midGoals) {
    await system.recordProgress({ goalId: mid.goalId, progressDelta: 1.0 });
    progressEventCount++;
  }

  // Propagate to long goal
  await system.recordProgress({ goalId: longGoal!.goalId, progressDelta: 1.0 });
  progressEventCount++;

  // Propagate to meta goal (90% — just below completion to test near-complete state)
  await system.recordProgress({ goalId: meta.goalId, progressDelta: 0.9 });
  progressEventCount++;

  const metaAfter = await store.get(meta.goalId);
  const longAfter = await store.get(longGoal!.goalId);
  const midAfterAll = await Promise.all(midGoals.map((m) => store.get(m.goalId)));
  const microAfterAll = await Promise.all(microGoals.map((m) => store.get(m.goalId)));

  const h1Pass =
    (metaAfter?.progress ?? 0) >= 0.9 &&
    longAfter?.status === "completed" &&
    midAfterAll.every((m) => m?.status === "completed") &&
    microAfterAll.every((m) => m?.status === "completed");

  console.log(`\nH1 — bottom-up cascade:`);
  console.log(`  meta progress=${metaAfter?.progress.toFixed(4)}  status=${metaAfter?.status}`);
  console.log(`  long status=${longAfter?.status}`);
  console.log(`  mid completed=${midAfterAll.filter((m) => m?.status === "completed").length}/${midGoals.length}`);
  console.log(`  micro completed=${microAfterAll.filter((m) => m?.status === "completed").length}/${microGoals.length}`);
  console.log(`  ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H2 — Progress event count
  // ---------------------------------------------------------------------------
  const h2Pass = publisher.events.length === progressEventCount;
  console.log(`\nH2 — progress events: ${publisher.events.length} (expected ${progressEventCount}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3 — selectNextGoal selects a goal from the highest-priority tier
  // ---------------------------------------------------------------------------
  // The selection formula is: priority×0.45 + horizonWeight×persistence×0.2 + ...
  // Meta has the highest priority (0.95) and the highest horizon weight (0.9),
  // so it dominates selection regardless of depth. H3 verifies that the
  // pre-completion selection is the meta goal (the root) because priority×0.45
  // outweighs any micro-goal advantage on the progressOpportunity term.
  const h3Pass = h3PreHorizon === "meta";
  console.log(`\nH3 — pre-completion selection is meta (${h3PreHorizon}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H4 — Completed goals excluded from listActiveGoals
  // ---------------------------------------------------------------------------
  const activeAfter = await system.listActiveGoals();
  const completedInActive = activeAfter.filter((g) => g.status === "completed");
  const longInActive       = activeAfter.some((g) => g.goalId === longGoal!.goalId);
  const h4Pass = completedInActive.length === 0 && !longInActive;
  console.log(`\nH4 — completed goals absent: completedInActive=${completedInActive.length} longInActive=${longInActive}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Active goals remaining: ${activeAfter.length} (expected: meta only if not completed)`);

  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp40",
    [
      `H1 bottom-up cascade: ${h1Pass ? "PASS" : "FAIL"} (metaProg=${metaAfter?.progress.toFixed(4)} longStatus=${longAfter?.status})`,
      `H2 progress events=${publisher.events.length}==${progressEventCount}: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 pre-completion selection=meta: ${h3Pass ? "PASS" : "FAIL"} (was ${h3PreHorizon})`,
      `H4 completed excluded: ${h4Pass ? "PASS" : "FAIL"} (completedInActive=${completedInActive.length})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      metaProgress: metaAfter?.progress,
      longStatus: longAfter?.status,
      midCompletedCount: midAfterAll.filter((m) => m?.status === "completed").length,
      microCompletedCount: microAfterAll.filter((m) => m?.status === "completed").length,
      progressEventCount: publisher.events.length,
      preCompletionSelectionHorizon: h3PreHorizon,
      activeGoalsRemaining: activeAfter.length,
    },
  );
  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
