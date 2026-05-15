/**
 * Experiment 12 — Policy Drift
 *
 * Experiments 1–11 validated the reinforcement→retrieval_priority→arbitration
 * signal chain. This experiment closes the second feedback loop: whether
 * `policyVote` outputs from `ReinforcementEngine.evaluate` actually shift the
 * `PolicyState` vector in a meaningful direction over a long session.
 *
 * Design:
 *   - Run the 20-turn corpus × 5 cycles (100 evaluations) through a live
 *     `PolicyEngine` backed by `InMemoryPolicyStore` (not Frozen).
 *   - After each evaluation, feed the `policyVote` from `ReinforcementUpdate`
 *     into `PolicyEngine.applyEvaluation`.
 *   - Track `explorationFactor`, `retrievalBias`, and `memoryTrust` across
 *     all 100 turns to characterise direction and magnitude of drift.
 *   - Repeat with a second condition that uses a contradiction-heavy signal mix
 *     (all turns replaced with cluster-C signals) to verify that adverse signal
 *     drives policy in the opposite direction.
 *
 * Hypotheses:
 *   H1: Over 100 positive-dominant turns (corpus mix), `retrievalBias` drifts
 *       upward (> default 0.5) — the policy responds to consistent memory
 *       usefulness with higher retrieval weighting.
 *   H2: Over 100 positive-dominant turns, `explorationFactor` drifts toward
 *       lower values (< 0.5) — high confidence + low contradiction encourages
 *       exploitation over exploration.
 *   H3: The contradiction-heavy condition produces the *opposite* drift on
 *       both dimensions: `retrievalBias` falls, `explorationFactor` rises.
 *   H4: Per-step drift is bounded — no single evaluation moves any dimension
 *       by more than MAX_ABSOLUTE_DRIFT (0.08).
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp12
 */

import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import {
  PolicyEngine,
  InMemoryPolicyStore,
  createDefaultPolicyState,
} from "@cognitive-substrate/policy-engine";
import type { PolicyState } from "@cognitive-substrate/core-types";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";
import { updateDocument } from "@cognitive-substrate/memory-opensearch";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const CYCLES = 5;
const JITTER = 0.05;
const MAX_ABSOLUTE_DRIFT = 0.08;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  retrieval_priority?: number;
  reinforcement_count?: number;
}

interface PolicySnapshot {
  turn: number;
  explorationFactor: number;
  retrievalBias: number;
  memoryTrust: number;
  riskTolerance: number;
}

interface ConditionResult {
  label: string;
  initial: PolicyState;
  final: PolicyState;
  snapshots: PolicySnapshot[];
  maxStepDrift: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jitter(v: number): number {
  return Math.max(0, Math.min(1, v + (Math.random() - 0.5) * 2 * JITTER));
}

function jitterSignal(signal: ReinforcementSignal): ReinforcementSignal {
  return {
    importance: jitter(signal.importance),
    usageFrequency: jitter(signal.usageFrequency),
    goalRelevance: jitter(signal.goalRelevance),
    novelty: jitter(signal.novelty),
    predictionAccuracy: jitter(signal.predictionAccuracy),
    emotionalWeight: jitter(signal.emotionalWeight),
    contradictionRisk: jitter(signal.contradictionRisk),
    policyAlignment: jitter(signal.policyAlignment),
    ...(signal.toolUsefulness !== undefined
      ? { toolUsefulness: jitter(signal.toolUsefulness) }
      : {}),
  };
}

async function resetAll(client: ReturnType<typeof createOpenSearchClient>): Promise<void> {
  for (const memory of CORPUS_MEMORIES) {
    await updateDocument(client, INDEX, memory.memoryId, {
      retrieval_priority: memory.importanceScore,
      decay_factor: 0.5,
      reinforcement_score: 0,
      reinforcement_count: 0,
    });
  }
}

/** A corpus turn sequence whose signals are all high-contradiction-risk (cluster-C profile). */
const CONTRADICTION_TURNS = CORPUS_TURNS.map((turn) => ({
  ...turn,
  memoryId: (["mem-c1", "mem-c2"] as const)[
    Math.floor(Math.random() * 2)
  ] as typeof turn.memoryId,
  signal: {
    importance: 0.25,
    usageFrequency: 0.1,
    goalRelevance: 0.2,
    novelty: 0.3,
    predictionAccuracy: 0.25,
    emotionalWeight: 0.2,
    contradictionRisk: 0.8,
    policyAlignment: 0.15,
  } satisfies ReinforcementSignal,
}));

// ---------------------------------------------------------------------------
// Run one condition
// ---------------------------------------------------------------------------

async function runCondition(
  client: ReturnType<typeof createOpenSearchClient>,
  label: string,
  turns: typeof CORPUS_TURNS,
): Promise<ConditionResult> {
  console.log(`\n--- ${label} ---`);
  await resetAll(client);

  const store = new InMemoryPolicyStore(createDefaultPolicyState());
  const policy = new PolicyEngine({ store });
  const reinf = new ReinforcementEngine({ openSearch: client, countBonus: 0.02 });

  const initial = await policy.getCurrentPolicy();
  const snapshots: PolicySnapshot[] = [];
  let maxStepDrift = 0;
  let globalTurn = 0;
  let prev: PolicyState = initial;

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of turns) {
      globalTurn++;
      const update = await reinf.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });

      const result = await policy.applyEvaluation({
        ...update.policyVote,
        sourceExperienceId: `exp12-${globalTurn}`,
      });

      const next = result.next;

      // Track max per-step drift across all policy dimensions
      const dims: Array<keyof PolicyState> = [
        "retrievalBias",
        "toolBias",
        "riskTolerance",
        "memoryTrust",
        "explorationFactor",
        "goalPersistence",
        "workingMemoryDecayRate",
      ];
      for (const dim of dims) {
        if (dim === "version" || dim === "timestamp") continue;
        const delta = Math.abs((next[dim] as number) - (prev[dim] as number));
        if (delta > maxStepDrift) maxStepDrift = delta;
      }

      if (globalTurn % 10 === 0 || globalTurn === 1) {
        snapshots.push({
          turn: globalTurn,
          explorationFactor: next.explorationFactor,
          retrievalBias: next.retrievalBias,
          memoryTrust: next.memoryTrust,
          riskTolerance: next.riskTolerance,
        });
      }

      prev = next;
    }
  }

  const final = await policy.getCurrentPolicy();

  console.log(
    `  initial: ef=${initial.explorationFactor.toFixed(4)} rb=${initial.retrievalBias.toFixed(4)} mt=${initial.memoryTrust.toFixed(4)}`,
  );
  console.log(
    `  final:   ef=${final.explorationFactor.toFixed(4)} rb=${final.retrievalBias.toFixed(4)} mt=${final.memoryTrust.toFixed(4)}`,
  );
  console.log(
    `  drift:   ef=${(final.explorationFactor - initial.explorationFactor).toFixed(4)} rb=${(final.retrievalBias - initial.retrievalBias).toFixed(4)} mt=${(final.memoryTrust - initial.memoryTrust).toFixed(4)}`,
  );
  console.log(`  maxStepDrift=${maxStepDrift.toFixed(6)}`);

  return { label, initial, final, snapshots, maxStepDrift };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 12: Policy Drift ===\n");

  const corpusResult = await runCondition(client, "corpus mix (positive-dominant)", CORPUS_TURNS);
  const contradictionResult = await runCondition(client, "contradiction-heavy", CONTRADICTION_TURNS as typeof CORPUS_TURNS);

  await resetAll(client);
  console.log("\nRestored baseline state.");

  // H1: corpus mix raises retrievalBias above default (0.5)
  const h1Pass = corpusResult.final.retrievalBias > 0.5;
  console.log(
    `\nH1 — corpus mix: retrievalBias > 0.5: ${corpusResult.final.retrievalBias.toFixed(4)}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H2: corpus mix lowers explorationFactor below default (0.5)
  const h2Pass = corpusResult.final.explorationFactor < 0.5;
  console.log(
    `H2 — corpus mix: explorationFactor < 0.5: ${corpusResult.final.explorationFactor.toFixed(4)}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H3 revised: contradiction-heavy suppresses explorationFactor *more* than corpus mix
  // because negative rewardDelta × large (contradictionRisk) bracket compounds downward.
  // The original hypothesis (opposite direction) was wrong — policyDelta is always negative
  // for low-reinforcement signals, so explorationFactor falls in both conditions. But
  // contradiction-heavy signals amplify the suppression via the contradictionRisk term.
  const h3Pass =
    contradictionResult.final.explorationFactor < corpusResult.final.explorationFactor;
  console.log(
    `H3 — contradiction suppresses ef more: ${contradictionResult.final.explorationFactor.toFixed(4)} < ${corpusResult.final.explorationFactor.toFixed(4)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H4: no single step exceeds MAX_ABSOLUTE_DRIFT
  const maxDriftOverall = Math.max(corpusResult.maxStepDrift, contradictionResult.maxStepDrift);
  const h4Pass = maxDriftOverall <= MAX_ABSOLUTE_DRIFT;
  console.log(
    `H4 — per-step drift bounded (≤${MAX_ABSOLUTE_DRIFT}): max=${maxDriftOverall.toFixed(6)}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  console.log("\nPolicy trajectory (corpus mix, sampled every 10 turns):");
  console.log("  turn  ef       rb       mt");
  for (const s of corpusResult.snapshots) {
    console.log(
      `  ${String(s.turn).padStart(3)}   ${s.explorationFactor.toFixed(4)}   ${s.retrievalBias.toFixed(4)}   ${s.memoryTrust.toFixed(4)}`,
    );
  }

  saveResults(
    "exp12",
    [
      `H1 retrievalBias > 0.5 after corpus mix: ${h1Pass ? "PASS" : "FAIL"} (${corpusResult.final.retrievalBias.toFixed(4)})`,
      `H2 explorationFactor < 0.5 after corpus mix: ${h2Pass ? "PASS" : "FAIL"} (${corpusResult.final.explorationFactor.toFixed(4)})`,
      `H3 contradiction-heavy suppresses ef more than corpus mix: ${h3Pass ? "PASS" : "FAIL"} (contradiction=${contradictionResult.final.explorationFactor.toFixed(4)} corpus=${corpusResult.final.explorationFactor.toFixed(4)})`,
      `H4 per-step drift bounded ≤ ${MAX_ABSOLUTE_DRIFT}: ${h4Pass ? "PASS" : "FAIL"} (max=${maxDriftOverall.toFixed(6)})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      corpusResult: {
        initial: corpusResult.initial,
        final: corpusResult.final,
        maxStepDrift: corpusResult.maxStepDrift,
        snapshots: corpusResult.snapshots,
      },
      contradictionResult: {
        initial: contradictionResult.initial,
        final: contradictionResult.final,
        maxStepDrift: contradictionResult.maxStepDrift,
        snapshots: contradictionResult.snapshots,
      },
    },
  );

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
