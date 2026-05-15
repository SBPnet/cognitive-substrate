/**
 * Experiment 16 — Re-Consolidation
 *
 * Experiment 13 found that without re-retrieval, temporal decay causes
 * catastrophic convergence: cluster-A's Hebbian gains erode and by epoch 100
 * cluster-C exceeds cluster-A in retrieval_priority. The fix is a periodic
 * background reinforcement pass (re-consolidation) that re-evaluates high-
 * importance memories even when they haven't been directly retrieved.
 *
 * Design:
 *   1. Establish a reinforced rp landscape (100 turns, cb=0.02) — same as Exp 13.
 *   2. Simulate 100 decay epochs in-memory under two conditions:
 *      a. No re-consolidation (Exp 13 baseline — catastrophic convergence).
 *      b. Re-consolidation every R epochs: re-evaluate all memories whose
 *         current rp > RECON_THRESHOLD with a light positive signal
 *         (importance=importanceScore, low jitter). This simulates a background
 *         "health check" that selectively touches trusted memories.
 *   3. Compare cluster ordering and A-C gap at epochs {0, 10, 20, 50, 100}.
 *
 * Re-consolidation rule: every R epochs, all memories with rp > RECON_THRESHOLD
 * receive one reinforcement evaluation. This is selective — low-rp memories
 * (cluster-C) don't qualify, so they don't receive the boost.
 *
 * Hypotheses:
 *   H1: Without re-consolidation (baseline), A-C gap inverts by epoch 100
 *       (reproduces Exp 13 finding — gap goes negative).
 *   H2: Re-consolidation every 10 epochs reduces the magnitude of inversion
 *       vs no-recon (gap improves, even if still slightly negative at t=100).
 *   H3: Re-consolidation narrows the absolute decay of cluster-A but does
 *       not prevent cluster-C from decaying below its importanceScore baseline.
 *   H4: Re-consolidation every 5 epochs is sufficient to preserve a positive
 *       A-C gap at epoch 100 — the ordering is fully restored at higher frequency.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp16
 */

import {
  createOpenSearchClient,
  getDocument,
  updateDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { CORPUS_TURNS, CORPUS_MEMORIES, ALL_MEMORY_IDS } from "./corpus.js";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

const INDEX = "memory_semantic" as const;
const CYCLES = 5;
const JITTER = 0.05;
const DECAY_EPOCHS = [0, 10, 20, 50, 100] as const;
const EPOCH_SCALE = 20;
const RECON_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  importance_score: number;
  retrieval_priority?: number;
  decay_factor?: number;
}

interface MemoryState {
  memoryId: string;
  importanceScore: number;
  rp: number;
  decayFactor: number;
}

interface ClusterSnapshot {
  epochs: number;
  clusterA: number;
  clusterB: number;
  clusterC: number;
  acGap: number;
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

async function getAllStates(
  client: ReturnType<typeof createOpenSearchClient>,
): Promise<MemoryState[]> {
  return Promise.all(
    ALL_MEMORY_IDS.map(async (id) => {
      const doc = await getDocument<SemanticDoc>(client, INDEX, id);
      const corpus = CORPUS_MEMORIES.find((m) => m.memoryId === id)!;
      return {
        memoryId: id,
        importanceScore: corpus.importanceScore,
        rp: doc?.retrieval_priority ?? 0,
        decayFactor: doc?.decay_factor ?? 0.5,
      };
    }),
  );
}

function clusterAvg(states: MemoryState[], prefix: string): number {
  const members = states.filter((s) => s.memoryId.startsWith(`mem-${prefix}`));
  return members.reduce((sum, s) => sum + s.rp, 0) / members.length;
}

/** Scaled epoch decay rate — same formula as Exp 13. */
function epochDecayRate(decayFactor: number): number {
  return 1 - (1 - decayFactor) / EPOCH_SCALE;
}

/**
 * Projects rp over N epochs without re-consolidation.
 */
function applyDecayEpochs(states: MemoryState[], epochs: number): MemoryState[] {
  return states.map((s) => ({
    ...s,
    rp: Math.max(0, s.rp * Math.pow(epochDecayRate(s.decayFactor), epochs)),
  }));
}

/**
 * Applies one re-consolidation pass: memories with rp > RECON_THRESHOLD
 * receive a small positive rp boost (proportional to their importanceScore).
 * Simulates background evaluation with a light positive signal.
 * Low-rp memories (cluster-C) fall below the threshold and don't qualify.
 */
function applyReconsolidation(states: MemoryState[]): MemoryState[] {
  return states.map((s) => {
    if (s.rp <= RECON_THRESHOLD) return s;
    // Boost: small fraction of importanceScore, attenuated so it doesn't
    // fully restore — it just slows the descent.
    const boost = s.importanceScore * 0.04;
    return { ...s, rp: Math.min(1, s.rp + boost) };
  });
}

/**
 * Simulates N decay epochs with periodic re-consolidation every reconInterval
 * epochs. Returns snapshots at the configured checkpoints.
 */
function simulateWithRecon(
  initialStates: MemoryState[],
  totalEpochs: number,
  reconInterval: number,
): ClusterSnapshot[] {
  let states = initialStates.map((s) => ({ ...s }));
  const snapshots: ClusterSnapshot[] = [];
  const checkpointSet = new Set(DECAY_EPOCHS as readonly number[]);

  for (let epoch = 0; epoch <= totalEpochs; epoch++) {
    if (checkpointSet.has(epoch)) {
      const a = clusterAvg(states, "a");
      const b = clusterAvg(states, "b");
      const c = clusterAvg(states, "c");
      snapshots.push({ epochs: epoch, clusterA: a, clusterB: b, clusterC: c, acGap: a - c });
    }
    if (epoch < totalEpochs) {
      // Apply one epoch of decay
      states = states.map((s) => ({
        ...s,
        rp: Math.max(0, s.rp * epochDecayRate(s.decayFactor)),
      }));
      // Re-consolidate if this epoch is a consolidation boundary
      if (reconInterval > 0 && (epoch + 1) % reconInterval === 0) {
        states = applyReconsolidation(states);
      }
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 16: Re-Consolidation ===\n");

  await resetAll(client);

  // Phase 1: 100 reinforcement turns to establish differentiated rp landscape
  console.log("Phase 1: 100 reinforcement turns (cb=0.02)...");
  const engine = new ReinforcementEngine({ openSearch: client, countBonus: 0.02 });
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const turn of CORPUS_TURNS) {
      await engine.evaluate({
        memoryId: turn.memoryId,
        memoryIndex: INDEX,
        signal: jitterSignal(turn.signal),
      });
    }
  }

  const initialStates = await getAllStates(client);
  await resetAll(client);
  console.log("\nPost-reinforcement state read. Running decay simulations...");

  // Phase 2: simulate three conditions
  const noRecon = simulateWithRecon(initialStates, 100, 0);
  const recon10 = simulateWithRecon(initialStates, 100, 10);
  const recon5 = simulateWithRecon(initialStates, 100, 5);

  const clusterCBaseline =
    CORPUS_MEMORIES.filter((m) => m.memoryId.startsWith("mem-c")).reduce(
      (sum, m) => sum + m.importanceScore,
      0,
    ) / 2;

  const header = "  epochs  cluster-A  cluster-B  cluster-C  A-C gap";
  const row = (s: ClusterSnapshot) =>
    `  ${String(s.epochs).padStart(6)}  ${s.clusterA.toFixed(4)}     ${s.clusterB.toFixed(4)}     ${s.clusterC.toFixed(4)}     ${s.acGap.toFixed(4)}`;

  console.log("\nNo re-consolidation (Exp 13 baseline):");
  console.log(header);
  for (const s of noRecon) console.log(row(s));

  console.log("\nRe-consolidation every 10 epochs:");
  console.log(header);
  for (const s of recon10) console.log(row(s));

  console.log("\nRe-consolidation every 5 epochs:");
  console.log(header);
  for (const s of recon5) console.log(row(s));

  const at100NoRecon = noRecon.find((s) => s.epochs === 100)!;
  const at100Recon10 = recon10.find((s) => s.epochs === 100)!;
  const at100Recon5 = recon5.find((s) => s.epochs === 100)!;
  const at0 = noRecon.find((s) => s.epochs === 0)!;

  // H1: no-recon inverts A-C gap by epoch 100
  const h1Pass = at100NoRecon.acGap < 0;
  console.log(
    `\nH1 — no-recon A-C gap inverts: ${at100NoRecon.acGap.toFixed(4)} < 0: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H2: recon-10 reduces inversion magnitude vs no-recon (gap improves toward zero)
  const h2Pass = at100Recon10.acGap > at100NoRecon.acGap;
  console.log(
    `H2 — recon-10 reduces inversion vs no-recon: ${at100Recon10.acGap.toFixed(4)} > ${at100NoRecon.acGap.toFixed(4)}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H3: cluster-C stays below importanceScore baseline under both recon conditions
  const h3Pass = at100Recon10.clusterC < clusterCBaseline && at100Recon5.clusterC < clusterCBaseline;
  console.log(
    `H3 — cluster-C below baseline at t=100 (recon-10=${at100Recon10.clusterC.toFixed(4)}, recon-5=${at100Recon5.clusterC.toFixed(4)}) < ${clusterCBaseline.toFixed(4)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H4: recon-5 is sufficient to preserve positive A-C gap at epoch 100
  const h4Pass = at100Recon5.acGap > 0;
  console.log(
    `H4 — recon-5 preserves positive A-C gap at epoch 100: ${at100Recon5.acGap.toFixed(4)} > 0: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  saveResults(
    "exp16",
    [
      `H1 no-recon A-C gap inverts by epoch 100: ${h1Pass ? "PASS" : "FAIL"} (gap=${at100NoRecon.acGap.toFixed(4)})`,
      `H2 recon-10 reduces inversion vs no-recon: ${h2Pass ? "PASS" : "FAIL"} (${at100Recon10.acGap.toFixed(4)} vs ${at100NoRecon.acGap.toFixed(4)})`,
      `H3 cluster-C below importanceScore baseline under both recon conditions: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 recon-5 preserves positive A-C gap at epoch 100: ${h4Pass ? "PASS" : "FAIL"} (gap=${at100Recon5.acGap.toFixed(4)})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      clusterCBaseline,
      reconThreshold: RECON_THRESHOLD,
      epochScale: EPOCH_SCALE,
      conditions: {
        noRecon,
        recon10,
        recon5,
      },
    },
  );

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
