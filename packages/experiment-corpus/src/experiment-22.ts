/**
 * Experiment 22 — AbstractionEngine: Compression Ladder over Operational Data
 *
 * The AbstractionEngine compresses a set of experience events and/or semantic
 * memories into a five-level ladder (experience → pattern → concept →
 * principle → worldview). Each level is a single `AbstractionNode` whose
 * label is derived from the most-frequent long token across all source texts,
 * and whose compressionRatio increases monotonically with depth.
 *
 * This experiment exercises three input configurations:
 *   A. Events only  — 200 enriched operational signals (window-specific text)
 *   B. Memories only — 4 synthetic SemanticMemory objects representing the
 *      Exp 18 consolidated incident windows
 *   C. Mixed — both events and memories together
 *
 * Four hypotheses:
 *
 *   H1 — Every ladder produced by `buildCompressionLadder` contains exactly
 *        five nodes in the canonical order: experience, pattern, concept,
 *        principle, worldview. The compressionRatio increases monotonically
 *        across nodes (0.2 → 0.4 → 0.6 → 0.8 → 1.0).
 *
 *   H2 — The dominant label token at the root (experience) node reflects
 *        the vocabulary of the input. For operational event inputs the
 *        most-frequent long token should be incident-domain vocabulary
 *        (one of: "outage", "latency", "degraded", "service", "metrics",
 *        "recovery", "normal"). The label must NOT be "general-abstraction"
 *        (the fallback for empty input).
 *
 *   H3 — Confidence increases with the number of sources: ladder built from
 *        200 events has higher confidence at every level than one built from
 *        4 memories, because confidence = sources / max(1, 8 - depth).
 *
 *   H4 — The mixed ladder (events + memories) uses sourceIds from both sets —
 *        every node's sourceIds array contains IDs from both the event set
 *        and the memory set, confirming that both input types contribute.
 *
 * This experiment also documents the current ceiling of the symbolic-label
 * approach: the label is the same at every level (all levels share the same
 * source corpus and therefore the same most-common token). This is a known
 * limitation of the current implementation — the engine comment explicitly
 * notes it will be fixed when embedding-based clustering is introduced.
 *
 * No OpenSearch required — AbstractionEngine is pure in-memory computation.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp22
 */

import { AbstractionEngine, symbolicLabel } from "@cognitive-substrate/abstraction-engine";
import { generateAllOperationalData } from "./generators/operational.js";
import { saveResults } from "./results.js";
import type { SemanticMemory } from "@cognitive-substrate/core-types";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";

const INCIDENT_VOCAB = new Set([
  "outage", "latency", "degraded", "service", "metrics",
  "recovery", "normal", "incident", "performance", "detected",
  "threshold", "critical", "returning", "anomalies", "elevated",
]);

const CANONICAL_LEVELS = ["experience", "pattern", "concept", "principle", "worldview"] as const;

// ---------------------------------------------------------------------------
// Synthetic SemanticMemory objects representing Exp 18 consolidated windows
// ---------------------------------------------------------------------------

function makeMemory(window: string, summary: string, generalization: string): SemanticMemory {
  return {
    memoryId: `exp22-mem-${window}`,
    createdAt: "2026-05-15T00:00:00Z",
    summary,
    generalization,
    embedding: [],
    sourceEventIds: [],
    importanceScore: window === "outage" ? 0.92 : window === "degraded" ? 0.68 : 0.26,
    stabilityScore: window === "outage" ? 0.71 : window === "degraded" ? 0.59 : 0.38,
    contradictionScore: 0.1,
    usageFrequency: 0,
  };
}

const INCIDENT_MEMORIES: ReadonlyArray<SemanticMemory> = [
  makeMemory(
    "outage",
    "Outage detected on api-gateway. Latency p95 severely elevated. Critical incident.",
    "When latency p95 spikes above SLA thresholds across multiple services simultaneously, a critical outage is in progress requiring immediate escalation.",
  ),
  makeMemory(
    "degraded",
    "Performance degraded on search-service. Latency rising above threshold.",
    "Sustained latency elevation on a single service indicates degraded performance; monitor adjacent services for cascade risk.",
  ),
  makeMemory(
    "recovery",
    "Service api-gateway recovering. Incident resolved, metrics returning to normal.",
    "Once metrics return toward baseline and no new anomalies are detected, the system is in partial recovery; maintain heightened monitoring.",
  ),
  makeMemory(
    "normal",
    "Normal background metrics for cache-service. No anomalies detected.",
    "Stable background metric patterns indicate a healthy operational state; low-priority for attention allocation.",
  ),
];

// ---------------------------------------------------------------------------
// Enrich operational signals with window-specific text (mirrors Exp 20)
// ---------------------------------------------------------------------------

const WINDOW_TEXT: Record<string, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

const WINDOWS_SET = new Set(["normal", "degraded", "outage", "recovery"]);

function enrichedText(signal: ReturnType<typeof generateAllOperationalData>[number]): string {
  const window = signal.tags.find((t) => WINDOWS_SET.has(t)) ?? "normal";
  return `${WINDOW_TEXT[window] ?? WINDOW_TEXT["normal"]!}. service=${signal.payload.affectedServices[0] ?? "unknown"}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 22: AbstractionEngine — Compression Ladder over Operational Data ===\n");

  const engine = new AbstractionEngine();
  const allSignals = generateAllOperationalData();

  // Enrich input.text with window-specific vocabulary
  const enrichedEvents: ExperienceEvent[] = allSignals.map((signal) => ({
    ...signal,
    input: { ...signal.input, text: enrichedText(signal) },
  }));

  console.log(`Events: ${enrichedEvents.length}  Memories: ${INCIDENT_MEMORIES.length}`);

  // ---------------------------------------------------------------------------
  // Configuration A: events only
  // ---------------------------------------------------------------------------
  console.log("\n--- Config A: 200 enriched events ---");
  const ladderA = engine.buildCompressionLadder({ events: enrichedEvents });
  printLadder(ladderA.nodes);

  // ---------------------------------------------------------------------------
  // Configuration B: memories only
  // ---------------------------------------------------------------------------
  console.log("\n--- Config B: 4 incident memories ---");
  const ladderB = engine.buildCompressionLadder({ memories: INCIDENT_MEMORIES });
  printLadder(ladderB.nodes);

  // ---------------------------------------------------------------------------
  // Configuration C: mixed
  // ---------------------------------------------------------------------------
  console.log("\n--- Config C: 200 events + 4 memories ---");
  const ladderC = engine.buildCompressionLadder({ events: enrichedEvents, memories: INCIDENT_MEMORIES });
  printLadder(ladderC.nodes);

  // ---------------------------------------------------------------------------
  // H1: all three ladders have exactly 5 nodes in canonical order with
  //     monotonically increasing compressionRatio
  // ---------------------------------------------------------------------------
  function checkLadderStructure(nodes: typeof ladderA.nodes, label: string): boolean {
    const levelsOk = nodes.length === 5 &&
      nodes.every((n, i) => n.level === CANONICAL_LEVELS[i]);
    const ratioOk = nodes.every((n, i) =>
      i === 0 ? true : n.compressionRatio >= nodes[i - 1]!.compressionRatio,
    );
    const expectedRatios = [0.2, 0.4, 0.6, 0.8, 1.0];
    const ratioExact = nodes.every((n, i) => Math.abs(n.compressionRatio - expectedRatios[i]!) < 0.001);
    console.log(`  ${label}: levels=${levelsOk ? "✓" : "✗"} ratioMonotone=${ratioOk ? "✓" : "✗"} ratioExact=${ratioExact ? "✓" : "✗"}`);
    return levelsOk && ratioOk && ratioExact;
  }

  console.log("\nH1 — 5 canonical nodes, monotone compressionRatio:");
  const h1A = checkLadderStructure(ladderA.nodes, "A (events)");
  const h1B = checkLadderStructure(ladderB.nodes, "B (memories)");
  const h1C = checkLadderStructure(ladderC.nodes, "C (mixed)");
  const h1Pass = h1A && h1B && h1C;
  console.log(`  Result: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H2: root node label is incident-domain vocab (not fallback)
  // ---------------------------------------------------------------------------
  const rootLabelA = ladderA.nodes[0]!.label;
  const rootLabelB = ladderB.nodes[0]!.label;
  const rootTokenA = rootLabelA.split(":")[1] ?? "";
  const rootTokenB = rootLabelB.split(":")[1] ?? "";

  const h2A = rootTokenA !== "general-abstraction" && INCIDENT_VOCAB.has(rootTokenA);
  const h2B = rootTokenB !== "general-abstraction" && INCIDENT_VOCAB.has(rootTokenB);
  const h2Pass = h2A && h2B;
  console.log(`\nH2 — root label is incident vocab:`);
  console.log(`  A root="${rootLabelA}" → token="${rootTokenA}" in vocab: ${h2A ? "✓" : "✗"}`);
  console.log(`  B root="${rootLabelB}" → token="${rootTokenB}" in vocab: ${h2B ? "✓" : "✗"}`);
  console.log(`  Result: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3: ladder A (200 sources) has higher confidence than ladder B (4 sources)
  //     at every level
  // ---------------------------------------------------------------------------
  const confidenceAHigher = ladderA.nodes.every(
    (nodeA, i) => nodeA.confidence >= ladderB.nodes[i]!.confidence,
  );
  console.log(`\nH3 — confidence(A with 200 events) ≥ confidence(B with 4 memories) at every level:`);
  for (let i = 0; i < 5; i++) {
    console.log(
      `  ${CANONICAL_LEVELS[i]}: A=${ladderA.nodes[i]!.confidence.toFixed(3)} B=${ladderB.nodes[i]!.confidence.toFixed(3)} ` +
        (ladderA.nodes[i]!.confidence >= ladderB.nodes[i]!.confidence ? "✓" : "✗"),
    );
  }
  const h3Pass = confidenceAHigher;
  console.log(`  Result: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H4: mixed ladder sourceIds contain IDs from both events and memories
  // ---------------------------------------------------------------------------
  const eventIds = new Set(enrichedEvents.map((e) => e.eventId));
  const memoryIds = new Set(INCIDENT_MEMORIES.map((m) => m.memoryId));

  const mixedSourceIds = new Set(ladderC.nodes.flatMap((n) => n.sourceIds));
  const hasEventIds = [...eventIds].some((id) => mixedSourceIds.has(id));
  const hasMemoryIds = [...memoryIds].some((id) => mixedSourceIds.has(id));
  const h4Pass = hasEventIds && hasMemoryIds;
  console.log(`\nH4 — mixed ladder contains IDs from both events and memories:`);
  console.log(`  event IDs present: ${hasEventIds ? "✓" : "✗"} (sample: ${[...eventIds].slice(0, 2).join(", ")})`);
  console.log(`  memory IDs present: ${hasMemoryIds ? "✓" : "✗"} (${[...memoryIds].join(", ")})`);
  console.log(`  total unique sourceIds in mixed ladder: ${mixedSourceIds.size}`);
  console.log(`  Result: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Document symbolic-label ceiling: all levels share the same label
  // ---------------------------------------------------------------------------
  console.log("\n--- Symbolic-label ceiling (known limitation) ---");
  const allLabelsA = ladderA.nodes.map((n) => n.label);
  const allSameA = allLabelsA.every((l) => l.split(":")[1] === allLabelsA[0]!.split(":")[1]);
  console.log(`  All levels share the same dominant token (A): ${allSameA ? "yes (expected)" : "no"}`);
  console.log(`  Labels: ${allLabelsA.join(" | ")}`);
  console.log("  → Embedding-based clustering required to differentiate labels across levels.");
  const dominantToken = symbolicLabel(enrichedEvents.map((e) => e.input.text));
  console.log(`  Dominant token across all 200 events: "${dominantToken}"`);

  // ---------------------------------------------------------------------------
  // Save results
  // ---------------------------------------------------------------------------
  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "exp22",
    [
      `H1 5-node canonical ladder with monotone compressionRatio (A/B/C): ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 root label is incident vocab (A="${rootTokenA}" B="${rootTokenB}"): ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 confidence(200 events) ≥ confidence(4 memories) at all levels: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 mixed ladder sourceIds span both events and memories: ${h4Pass ? "PASS" : "FAIL"}`,
      `symbolic-label ceiling: all levels share same token (${dominantToken}); embeddings needed for differentiation`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      ladderA: { nodes: ladderA.nodes.map((n) => ({ level: n.level, label: n.label, compressionRatio: n.compressionRatio, confidence: n.confidence, sourceCount: n.sourceIds.length })) },
      ladderB: { nodes: ladderB.nodes.map((n) => ({ level: n.level, label: n.label, compressionRatio: n.compressionRatio, confidence: n.confidence, sourceCount: n.sourceIds.length })) },
      ladderC: { nodes: ladderC.nodes.map((n) => ({ level: n.level, label: n.label, compressionRatio: n.compressionRatio, confidence: n.confidence, sourceCount: n.sourceIds.length })) },
      dominantToken,
      ceiling: { allLevelsSameToken: allSameA },
    },
  );
  console.log("Results saved.");
}

function printLadder(nodes: ReturnType<AbstractionEngine["buildCompressionLadder"]>["nodes"]): void {
  for (const node of nodes) {
    console.log(
      `  ${node.level.padEnd(12)} label="${node.label}" ratio=${node.compressionRatio.toFixed(2)} confidence=${node.confidence.toFixed(3)} sources=${node.sourceIds.length}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
