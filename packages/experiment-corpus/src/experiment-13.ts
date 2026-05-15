/**
 * Experiment 13 — Temporal Decay
 *
 * The reinforcement engine writes a `decay_factor` to each memory document
 * alongside `retrieval_priority`. `decay_factor` is derived by:
 *
 *   decayAdjustment = 1 - reinforcement × 0.65
 *
 * So high-reinforcement memories get low decay_factor (slow decay) and
 * low-reinforcement memories get high decay_factor (fast decay). This was
 * validated as "live" in Exp 7 but its *compounding effect over time* has
 * not been measured.
 *
 * Design:
 *   1. Run 100 reinforcement turns (corpus mix, cb=0.02) to establish a
 *      differentiated retrieval_priority landscape across clusters A/B/C.
 *   2. Apply a "time skip" simulation: each memory's retrieval_priority is
 *      compounded by a *scaled* epoch decay factor. The raw `decay_factor`
 *      from the reinforcement engine represents per-turn decay rate within
 *      a session (very aggressive). For temporal simulation across idle days,
 *      we scale to a per-epoch rate:
 *
 *        epochDecay(m) = 1 - (1 - decay_factor(m)) / EPOCH_SCALE
 *        rp_after = rp_current × epochDecay(m)^epochs
 *
 *      With EPOCH_SCALE=20, a memory with decay_factor=0.5 has an epochDecay
 *      of 1-(0.5/20) = 0.975, losing ~2.5% per epoch — meaningful divergence
 *      over 100 epochs without total collapse.
 *
 *   3. Measure the cluster-level average rp before and after the time skip
 *      at epochs ∈ {0, 10, 20, 50, 100} to characterise the divergence
 *      trajectory.
 *
 * Hypotheses:
 *   H1: After reinforcement, cluster-A avg rp > cluster-B avg rp > cluster-C avg rp
 *       (confirms Exp 10/11 baseline).
 *   H2: After 50 decay epochs, cluster-C avg rp falls below its importanceScore
 *       baseline (0.225 = avg of 0.30, 0.15) — decay drives contradictory
 *       memories below their original weights.
 *   H3: The A-C rp gap *narrows* over time — cluster-A, starting high, loses
 *       more in absolute terms than cluster-C which starts near its floor.
 *       This is "catastrophic convergence": without continuous reinforcement,
 *       decay inverts the ordering established by compounding.
 *   H4: By epoch 100, cluster-A rp falls below its importanceScore baseline
 *       (0.775 avg) — long periods without reinforcement erase Hebbian gains.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp13
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
// Scale raw per-turn decay_factor to a per-epoch rate so that 100 epochs
// produces meaningful divergence without collapsing everything to zero.
// epochDecay(m) = 1 - (1 - decay_factor(m)) / EPOCH_SCALE
const EPOCH_SCALE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SemanticDoc extends Record<string, unknown> {
  memory_id: string;
  importance_score: number;
  retrieval_priority?: number;
  decay_factor?: number;
  reinforcement_score?: number;
}

interface MemoryState {
  memoryId: string;
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
      return {
        memoryId: id,
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

/**
 * Applies N epochs of temporal decay to a memory state list.
 * Uses scaled per-epoch decay rate so that 100 epochs produces meaningful
 * differentiation without collapsing all clusters to zero.
 * Does not write to OpenSearch — purely in-memory projection.
 */
function applyDecayEpochs(states: MemoryState[], epochs: number): MemoryState[] {
  return states.map((s) => {
    const epochDecay = 1 - (1 - s.decayFactor) / EPOCH_SCALE;
    return {
      ...s,
      rp: Math.max(0, s.rp * Math.pow(epochDecay, epochs)),
    };
  });
}

function snapshotAt(states: MemoryState[], epochs: number): ClusterSnapshot {
  const decayed = applyDecayEpochs(states, epochs);
  const a = clusterAvg(decayed, "a");
  const b = clusterAvg(decayed, "b");
  const c = clusterAvg(decayed, "c");
  return { epochs, clusterA: a, clusterB: b, clusterC: c, acGap: a - c };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = createOpenSearchClient(opensearchConfigFromEnv());
  console.log("=== Experiment 13: Temporal Decay ===\n");

  await resetAll(client);

  // Phase 1: 100 reinforcement turns to establish differentiated rp landscape
  console.log("Phase 1: running 100 reinforcement turns (cb=0.02)...");
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

  // Phase 2: read final states and project decay
  const states = await getAllStates(client);

  console.log("\nPost-reinforcement memory state:");
  for (const s of states) {
    console.log(
      `  ${s.memoryId}: rp=${s.rp.toFixed(4)} decay_factor=${s.decayFactor.toFixed(4)}`,
    );
  }

  // Compute snapshots at each epoch checkpoint
  const snapshots: ClusterSnapshot[] = DECAY_EPOCHS.map((e) => snapshotAt(states, e));

  console.log("\nDecay trajectory:");
  console.log("  epochs  cluster-A  cluster-B  cluster-C  A-C gap");
  for (const s of snapshots) {
    console.log(
      `  ${String(s.epochs).padStart(6)}  ${s.clusterA.toFixed(4)}     ${s.clusterB.toFixed(4)}     ${s.clusterC.toFixed(4)}     ${s.acGap.toFixed(4)}`,
    );
  }

  await resetAll(client);
  console.log("\nRestored baseline state.");

  const clusterCBaseline =
    CORPUS_MEMORIES.filter((m) => m.memoryId.startsWith("mem-c")).reduce(
      (sum, m) => sum + m.importanceScore,
      0,
    ) / 2;

  // H1: cluster ordering after reinforcement
  const atZero = snapshots[0]!;
  const h1Pass = atZero.clusterA > clusterAvg(applyDecayEpochs(states, 0), "b") &&
    clusterAvg(applyDecayEpochs(states, 0), "b") > atZero.clusterC;
  console.log(
    `\nH1 — post-reinforcement: A(${atZero.clusterA.toFixed(4)}) > B(${clusterAvg(applyDecayEpochs(states, 0), "b").toFixed(4)}) > C(${atZero.clusterC.toFixed(4)}): ${h1Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H2: cluster-C avg rp < baseline after 50 epochs
  const at50 = snapshots.find((s) => s.epochs === 50)!;
  const h2Pass = at50.clusterC < clusterCBaseline;
  console.log(
    `H2 — cluster-C rp after 50 epochs (${at50.clusterC.toFixed(4)}) < baseline (${clusterCBaseline.toFixed(4)}): ${h2Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H3: A-C gap narrows over time (catastrophic convergence)
  const at100 = snapshots.find((s) => s.epochs === 100)!;
  const at10 = snapshots.find((s) => s.epochs === 10)!;
  const h3Pass = at10.acGap < atZero.acGap && at100.acGap < at10.acGap;
  console.log(
    `H3 — A-C gap narrows (catastrophic convergence): t=0 gap=${atZero.acGap.toFixed(4)} → t=10 gap=${at10.acGap.toFixed(4)} → t=100 gap=${at100.acGap.toFixed(4)}: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H4: cluster-A rp at epoch 100 falls below importanceScore baseline avg
  const clusterABaseline =
    CORPUS_MEMORIES.filter((m) => m.memoryId.startsWith("mem-a")).reduce(
      (sum, m) => sum + m.importanceScore,
      0,
    ) / CORPUS_MEMORIES.filter((m) => m.memoryId.startsWith("mem-a")).length;
  const h4Pass = at100.clusterA < clusterABaseline;
  console.log(
    `H4 — cluster-A rp at t=100 (${at100.clusterA.toFixed(4)}) < importanceScore baseline (${clusterABaseline.toFixed(4)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  saveResults(
    "exp13",
    [
      `H1 post-reinforcement cluster ordering A>B>C: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 cluster-C rp < baseline after 50 epochs: ${h2Pass ? "PASS" : "FAIL"} (${at50.clusterC.toFixed(4)} vs ${clusterCBaseline.toFixed(4)})`,
      `H3 A-C gap narrows (catastrophic convergence): ${h3Pass ? "PASS" : "FAIL"} (${atZero.acGap.toFixed(4)}→${at10.acGap.toFixed(4)}→${at100.acGap.toFixed(4)})`,
      `H4 cluster-A rp falls below importanceScore baseline at t=100: ${h4Pass ? "PASS" : "FAIL"} (${at100.clusterA.toFixed(4)} vs ${clusterABaseline.toFixed(4)})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      clusterCBaseline,
      clusterABaseline,
      snapshots,
      memoryStates: states,
    },
  );

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
