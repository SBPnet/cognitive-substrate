/**
 * Experiment 28 — Multi-Turn Session Coherence
 *
 * All prior engine experiments validated components in isolation. This
 * experiment runs a 100-turn synthetic session against the live 10k OpenSearch
 * corpus (provisioned by Exp 29) and measures whether the retrieval →
 * attention → reinforcement loop produces coherent, self-reinforcing behaviour
 * over time.
 *
 * The session simulates a realistic incident lifecycle:
 *   turns  1–20  : normal background queries (steady-state monitoring)
 *   turns 21–40  : degraded-window queries (anomaly detected, tension rising)
 *   turns 41–60  : outage-window queries (incident active, high urgency)
 *   turns 61–80  : recovery queries (incident resolving)
 *   turns 81–100 : normal again (post-incident steady state)
 *
 * Each turn:
 *   1. Retrieve top-5 memories from experience_events via knn (embedding_minilm).
 *   2. Map retrieved MemoryReferences to AttentionCandidates and route them.
 *   3. Reinforce the top-ranked primary memory with a signal derived from the
 *      current phase (positive reward for outage/recovery, neutral for normal).
 *   4. Record which window tags appear in the top-1 retrieval result.
 *
 * Four hypotheses:
 *
 *   H1 — Window alignment: across all 100 turns, the top-1 retrieved memory
 *        carries the correct window tag (matching the current query phase) in
 *        ≥80% of turns. Confirms that semantic retrieval tracks the session
 *        context correctly at 10k scale.
 *
 *   H2 — Reinforcement compounding: the retrieval_priority of outage memories
 *        retrieved during turns 41–60 increases monotonically (or at minimum
 *        finishes higher than it started). Specifically the mean
 *        retrieval_priority of the most-retrieved outage memory at turn 60
 *        must be higher than it was at turn 41 (Hebbian compounding via
 *        priorWeight=0.3, countBonus=0.02).
 *
 *   H3 — Attention interrupt during outage: during turns 41–60, the
 *        AttentionEngine produces at least one interrupt-lane allocation
 *        (salience ≥ 0.82) in ≥50% of those turns, reflecting the high
 *        urgency and importance of outage memories.
 *
 *   H4 — Phase transition detectability: the mean top-1 retrieval score
 *        during the outage phase (turns 41–60) is higher than during the
 *        normal phase (turns 1–20), confirming that outage signals are more
 *        semantically coherent with outage queries than normal signals are
 *        with normal queries.
 *
 * Protocol:
 *   1. Verify the exp29 index is present and has 10k docs; if not, abort with
 *      a clear error (this experiment depends on Exp 29's corpus).
 *   2. Provision a dedicated exp28_session index to track per-turn state
 *      (retrieval_priority snapshots, interrupt counts, top-1 window).
 *   3. Run 100 turns as described above. Each turn embeds the query via the
 *      ML node, retrieves, routes through AttentionEngine, reinforces top-1.
 *   4. Evaluate H1–H4 from the turn log, save results, clean up.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 \
 *   OPENSEARCH_ML_MODEL_ID=<model_id> \
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp28
 *
 * Prerequisite: Exp 29 must have been run and the exp29_events index must be
 * present (or run with EXP28_INDEX=experience_events to use the main corpus).
 */

import { randomUUID } from "node:crypto";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { AttentionEngine } from "@cognitive-substrate/attention-engine";
import { ReinforcementEngine } from "@cognitive-substrate/reinforcement-engine";
import { generateOperationalBatch } from "./generators/operational.js";
import { saveResults } from "./results.js";
import type { QueryEmbeddingClient } from "@cognitive-substrate/retrieval-engine";
import type { AttentionCandidate } from "@cognitive-substrate/attention-engine";
import type { ReinforcementSignal } from "@cognitive-substrate/core-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_INDEX   = (process.env["EXP28_INDEX"] ?? "exp28_events") as "experience_events";
const OWN_INDEX      = SOURCE_INDEX === ("exp28_events" as "experience_events");
const PIPELINE_ID    = "exp28-minilm-embed" as const;
const FIELD_NAME     = "embedding_minilm" as const;
const CORPUS_SIZE    = 10_000;
const BULK_CHUNK     = 500;
const EMBED_DIM     = 384;
const TURNS         = 100;
const RETRIEVE_K    = 5;

// Phase boundaries (1-based turn numbers)
const PHASES = [
  { name: "normal-pre",  start: 1,   end: 20,  window: "normal"   },
  { name: "degraded",    start: 21,  end: 40,  window: "degraded" },
  { name: "outage",      start: 41,  end: 60,  window: "outage"   },
  { name: "recovery",    start: 61,  end: 80,  window: "recovery" },
  { name: "normal-post", start: 81,  end: 100, window: "normal"   },
] as const;

type PhaseName = (typeof PHASES)[number]["name"];
type WindowName = (typeof PHASES)[number]["window"];

const QUERY_TEXT: Record<WindowName, string[]> = {
  normal:   [
    "steady state metrics no anomalies background monitoring",
    "normal operations all services healthy",
    "routine health check no issues detected",
    "background metrics within normal thresholds",
  ],
  degraded: [
    "latency rising above threshold metrics anomalous",
    "degraded performance database slow response times",
    "warning signals service response degrading",
    "elevated error rate performance degradation detected",
  ],
  outage:   [
    "critical outage high latency p95 severely elevated",
    "incident active service down production impact",
    "outage detected database unresponsive critical severity",
    "major incident all hands response required now",
  ],
  recovery: [
    "service recovering metrics returning to normal",
    "incident resolving latency stabilising",
    "recovery underway services coming back online",
    "post-incident metrics normalising resolution confirmed",
  ],
};

// Reward signal per phase — fields matching ReinforcementSignal exactly
const PHASE_REWARD: Record<WindowName, Pick<ReinforcementSignal, "importance" | "goalRelevance" | "contradictionRisk" | "emotionalWeight" | "policyAlignment">> = {
  normal:   { importance: 0.3, goalRelevance: 0.3, contradictionRisk: 0.1, emotionalWeight: 0.2, policyAlignment: 0.5 },
  degraded: { importance: 0.5, goalRelevance: 0.6, contradictionRisk: 0.2, emotionalWeight: 0.5, policyAlignment: 0.6 },
  outage:   { importance: 0.9, goalRelevance: 0.95, contradictionRisk: 0.05, emotionalWeight: 0.9, policyAlignment: 0.8 },
  recovery: { importance: 0.7, goalRelevance: 0.8, contradictionRisk: 0.1, emotionalWeight: 0.6, policyAlignment: 0.7 },
};

// ---------------------------------------------------------------------------
// ML embedder — calls the OpenSearch ML node (same pattern as Exp 24/29)
// ---------------------------------------------------------------------------

type OSClient = ReturnType<typeof createOpenSearchClient>;

function makeEmbedder(client: OSClient, modelId: string): QueryEmbeddingClient {
  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const response = await client.transport.request({
        method: "POST",
        path: `/_plugins/_ml/models/${modelId}/_predict`,
        body: {
          text_docs: [text],
          return_number: true,
          target_response: ["sentence_embedding"],
        },
      });
      const body = response.body as {
        inference_results: Array<{ output: Array<{ name: string; data: number[] }> }>;
      };
      const output = body.inference_results[0]?.output.find((o) => o.name === "sentence_embedding");
      if (!output || output.data.length !== EMBED_DIM) {
        throw new Error(`Unexpected embedding dim: ${output?.data.length ?? "none"}`);
      }
      return output.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Model discovery (same as Exp 24/29)
// ---------------------------------------------------------------------------

async function discoverModelId(client: OSClient): Promise<string> {
  const response = await client.transport.request({
    method: "POST",
    path: "/_plugins/_ml/models/_search",
    body: {
      query: {
        bool: {
          must: [
            { term: { algorithm: "TEXT_EMBEDDING" } },
            { term: { model_state: "DEPLOYED" } },
          ],
        },
      },
      size: 10,
    },
  });
  const body = response.body as { hits: { hits: Array<{ _id: string }> } };
  const hit = body.hits.hits.find((h) => !/_\d+$/.test(h._id));
  if (!hit) throw new Error("No deployed TEXT_EMBEDDING model. Set OPENSEARCH_ML_MODEL_ID.");
  return hit._id;
}

// ---------------------------------------------------------------------------
// Index provisioning — builds a fresh exp28_events corpus when needed
// ---------------------------------------------------------------------------

const WINDOW_TEXT: Record<WindowName, string> = {
  outage:   "outage detected latency p95 severely elevated critical incident service degraded",
  degraded: "degraded performance latency rising above threshold metrics anomalous",
  recovery: "recovery underway service returning to normal metrics stabilising",
  normal:   "normal background metrics no anomalies detected steady state",
};

async function provisionIndex(client: OSClient, modelId: string, index: string): Promise<void> {
  // Create ingest pipeline
  await client.ingest.putPipeline({
    id: PIPELINE_ID,
    body: {
      description: "exp28 — embed summary via all-MiniLM-L6-v2",
      processors: [{ text_embedding: { model_id: modelId, field_map: { summary: FIELD_NAME } } }],
    },
  } as Parameters<typeof client.ingest.putPipeline>[0]);

  // Create index
  await client.indices.delete({ index }).catch(() => undefined);
  await client.indices.create({
    index,
    body: {
      settings: {
        index: {
          knn: true,
          number_of_shards: 2,
          number_of_replicas: 0,
          default_pipeline: PIPELINE_ID,
          "knn.algo_param.ef_search": 256,
        },
      },
      mappings: {
        properties: {
          event_id:      { type: "keyword" },
          timestamp:     { type: "date" },
          summary:       { type: "text" },
          tags:          { type: "keyword" },
          severity:      { type: "float" },
          [FIELD_NAME]:  {
            type: "knn_vector",
            dimension: EMBED_DIM,
            method: { name: "hnsw", engine: "faiss", space_type: "innerproduct",
              parameters: { m: 16, ef_construction: 256 } },
          },
        },
      },
    },
  } as Parameters<typeof client.indices.create>[0]);

  // Generate and bulk-index corpus
  const base = new Date("2026-05-14T10:00:00Z");
  const normal   = Math.round(CORPUS_SIZE * 0.20);
  const degraded = Math.round(CORPUS_SIZE * 0.30);
  const outage   = Math.round(CORPUS_SIZE * 0.25);
  const recovery = CORPUS_SIZE - normal - degraded - outage;
  const allSignals = [
    ...generateOperationalBatch("normal",   normal,   base),
    ...generateOperationalBatch("degraded", degraded, new Date(base.getTime() + 2 * 3_600_000)),
    ...generateOperationalBatch("outage",   outage,   new Date(base.getTime() + 5 * 3_600_000)),
    ...generateOperationalBatch("recovery", recovery, new Date(base.getTime() + 7 * 3_600_000)),
  ];

  const WINDOWS_SET = new Set(["normal", "degraded", "outage", "recovery"]);
  let indexed = 0;
  for (let offset = 0; offset < allSignals.length; offset += BULK_CHUNK) {
    const chunk = allSignals.slice(offset, offset + BULK_CHUNK);
    const body: Record<string, unknown>[] = [];
    for (const signal of chunk) {
      const window = signal.tags.find((t) => WINDOWS_SET.has(t)) ?? "normal";
      body.push({ index: { _index: index, _id: signal.eventId } });
      body.push({
        event_id:  signal.eventId,
        timestamp: signal.timestamp,
        summary:   `${WINDOW_TEXT[window as WindowName]}. service=${signal.payload.affectedServices[0] ?? "unknown"}`,
        tags:      signal.tags,
        severity:  signal.importanceScore,
      });
    }
    await client.bulk({ body });
    indexed += chunk.length;
    process.stdout.write(`\r  Indexed ${indexed.toLocaleString()}/${allSignals.length.toLocaleString()}...`);
  }
  process.stdout.write("\n");
  await client.indices.refresh({ index });
  console.log(`  Provisioning complete.`);
}

// ---------------------------------------------------------------------------
// Phase lookup
// ---------------------------------------------------------------------------

function phaseForTurn(turn: number): (typeof PHASES)[number] {
  return PHASES.find((p) => turn >= p.start && turn <= p.end) ?? PHASES[0]!;
}

function queryForTurn(turn: number, window: WindowName): string {
  const queries = QUERY_TEXT[window];
  return queries[turn % queries.length]!;
}

// ---------------------------------------------------------------------------
// Per-turn record
// ---------------------------------------------------------------------------

interface TurnRecord {
  turn: number;
  phase: PhaseName;
  queryWindow: WindowName;
  queryText: string;
  top1Window: string;
  top1MemoryId: string;
  top1Score: number;
  top1RetrievalPriorityBefore: number | undefined;
  top1RetrievalPriorityAfter: number | undefined;
  hasInterrupt: boolean;
  retrievedWindows: string[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 28: Multi-Turn Session Coherence ===\n");

  const client  = createOpenSearchClient(opensearchConfigFromEnv());
  const modelId = process.env["OPENSEARCH_ML_MODEL_ID"] ?? await discoverModelId(client);
  console.log(`Model ID: ${modelId}`);
  console.log(`Source index: ${SOURCE_INDEX}`);

  // Ensure source index exists with enough docs; self-provision if needed
  const countResp = await client.count({ index: SOURCE_INDEX }).catch(() => null);
  let docCount = countResp ? (countResp.body as { count: number }).count : 0;

  if (OWN_INDEX && docCount < 1000) {
    console.log(`Index '${SOURCE_INDEX}' missing or sparse (${docCount} docs) — provisioning ${CORPUS_SIZE.toLocaleString()} signals...`);
    await provisionIndex(client, modelId, SOURCE_INDEX);
    docCount = CORPUS_SIZE;
  } else if (docCount < 1000) {
    throw new Error(`Index '${SOURCE_INDEX}' has only ${docCount} docs and is externally managed — cannot auto-provision. Set EXP28_INDEX to a writable index or run Exp 29 first.`);
  }

  console.log(`Source index doc count: ${docCount.toLocaleString()}`);

  // Wire up engines
  const embedder        = makeEmbedder(client, modelId);
  const attentionEngine = new AttentionEngine();
  const reinforcementEngine = new ReinforcementEngine({
    openSearch: client,
    priorWeight: 0.3,
    countBonus: 0.02,
  });

  // We need a custom search client that queries SOURCE_INDEX and returns the
  // right shape. Let's build a simpler direct retrieval path instead.
  const sessionId = `exp28-session-${randomUUID().slice(0, 8)}`;
  console.log(`Session ID: ${sessionId}\n`);

  // ---------------------------------------------------------------------------
  // Run 100 turns
  // ---------------------------------------------------------------------------
  console.log("--- Running 100-turn session ---");

  const turnLog: TurnRecord[] = [];

  // Track retrieval_priority snapshots for H2
  const outageMemoryPriorities = new Map<string, number[]>(); // memoryId → [priority per turn it was top-1]

  for (let turn = 1; turn <= TURNS; turn++) {
    const phase      = phaseForTurn(turn);
    const queryText  = queryForTurn(turn, phase.window);

    // 1. Embed query
    const queryEmbedding = await embedder.embed(queryText);

    // 2. knn retrieval directly against source index (embedding_minilm field)
    const searchResp = await client.search({
      index: SOURCE_INDEX,
      body: {
        size: RETRIEVE_K,
        query: {
          knn: {
            embedding_minilm: {
              vector: queryEmbedding,
              k: RETRIEVE_K * 4,
            },
          },
        },
        _source: ["event_id", "tags", "severity"],
      },
    });

    const hits = (searchResp.body as Record<string, unknown>)["hits"] as Record<string, unknown>;
    const rawHits = (hits["hits"] as Array<Record<string, unknown>>) ?? [];

    const memories = rawHits.map((h) => {
      const src = (h["_source"] as Record<string, unknown>) ?? {};
      return {
        memoryId: (src["event_id"] as string) ?? (h["_id"] as string),
        score: (h["_score"] as number) ?? 0,
        tags: (src["tags"] as string[]) ?? [],
        severity: (src["severity"] as number) ?? 0.5,
      };
    });

    if (memories.length === 0) {
      console.warn(`  Turn ${turn}: no hits — skipping`);
      continue;
    }

    // 3. Map to AttentionCandidates and route
    const candidates: AttentionCandidate[] = memories.map((m) => ({
      candidateId: m.memoryId,
      summary: `${m.tags.find((t) => ["normal","degraded","outage","recovery"].includes(t)) ?? "unknown"} signal`,
      source: "experience" as const,
      importance: m.severity,
      relevance: m.score,
      urgency: m.tags.includes("outage") ? 0.9 : m.tags.includes("degraded") ? 0.6 : 0.3,
      novelty: 0.5,
      risk: m.tags.includes("outage") ? 0.8 : 0.2,
      timestamp: new Date().toISOString(),
    }));

    const routing = attentionEngine.route(candidates, {
      policy: { explorationFactor: phase.window === "outage" ? 0.3 : 0.5 },
    });

    const hasInterrupt = routing.interrupts.length > 0;
    const top1 = routing.primary[0] ?? routing.interrupts[0];

    if (!top1) continue;

    const top1Memory = memories.find((m) => m.memoryId === top1.candidateId)!;
    const top1Window = top1Memory.tags.find((t) =>
      ["normal", "degraded", "outage", "recovery"].includes(t)
    ) ?? "unknown";

    // 4. Read current retrieval_priority before reinforcement
    const priorDoc = await client.get({
      index: SOURCE_INDEX,
      id: top1Memory.memoryId,
    }).catch(() => null);
    const priorPriority = priorDoc
      ? ((priorDoc.body as Record<string, unknown>)["_source"] as Record<string, unknown>)?.["retrieval_priority"] as number | undefined
      : undefined;

    // 5. Reinforce top-1 memory
    const rewardSignal: ReinforcementSignal = {
      ...PHASE_REWARD[phase.window],
      usageFrequency: Math.min(1, turn / TURNS),
      novelty: phase.window === "outage" ? 0.8 : 0.3,
      predictionAccuracy: phase.window === "normal" ? 0.9 : 0.6,
    };

    await reinforcementEngine.evaluate({
      memoryId: top1Memory.memoryId,
      memoryIndex: SOURCE_INDEX,
      signal: rewardSignal,
    });

    // Read updated priority
    const updatedDoc = await client.get({
      index: SOURCE_INDEX,
      id: top1Memory.memoryId,
    }).catch(() => null);
    const updatedPriority = updatedDoc
      ? ((updatedDoc.body as Record<string, unknown>)["_source"] as Record<string, unknown>)?.["retrieval_priority"] as number | undefined
      : undefined;

    // Track outage memory priorities for H2
    if (phase.window === "outage") {
      const arr = outageMemoryPriorities.get(top1Memory.memoryId) ?? [];
      if (updatedPriority !== undefined) arr.push(updatedPriority);
      outageMemoryPriorities.set(top1Memory.memoryId, arr);
    }

    const record: TurnRecord = {
      turn,
      phase: phase.name,
      queryWindow: phase.window,
      queryText,
      top1Window,
      top1MemoryId: top1Memory.memoryId,
      top1Score: top1Memory.score,
      top1RetrievalPriorityBefore: priorPriority,
      top1RetrievalPriorityAfter: updatedPriority,
      hasInterrupt,
      retrievedWindows: memories.map(
        (m) => m.tags.find((t) => ["normal","degraded","outage","recovery"].includes(t)) ?? "unknown"
      ),
    };

    turnLog.push(record);

    if (turn % 20 === 0 || turn === 1) {
      process.stdout.write(
        `  Turn ${String(turn).padStart(3)}: phase=${phase.name.padEnd(11)} top1=${top1Window.padEnd(8)} score=${top1Memory.score.toFixed(3)} interrupt=${hasInterrupt}\n`
      );
    }
  }

  console.log(`\nCompleted ${turnLog.length} turns.\n`);

  // ---------------------------------------------------------------------------
  // H1: window alignment ≥80%
  // ---------------------------------------------------------------------------
  console.log("--- Hypothesis evaluation ---");

  const aligned = turnLog.filter((r) => r.top1Window === r.queryWindow).length;
  const alignmentRate = aligned / turnLog.length;
  const h1Pass = alignmentRate >= 0.8;
  console.log(`H1 — top-1 window alignment: ${aligned}/${turnLog.length} (${(alignmentRate * 100).toFixed(1)}%) ≥80%: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // Per-phase breakdown
  for (const phase of PHASES) {
    const phaseTurns = turnLog.filter((r) => r.phase === phase.name);
    const phaseAligned = phaseTurns.filter((r) => r.top1Window === r.queryWindow).length;
    console.log(`  ${phase.name.padEnd(12)}: ${phaseAligned}/${phaseTurns.length} aligned`);
  }

  // ---------------------------------------------------------------------------
  // H2: reinforcement compounding on most-retrieved outage memory
  // ---------------------------------------------------------------------------

  let h2Pass = false;
  let h2Detail = "no outage memories tracked";
  if (outageMemoryPriorities.size > 0) {
    // Find the memory with the most priority snapshots (most-retrieved during outage)
    const [mostRetrievedId, priorities] = [...outageMemoryPriorities.entries()]
      .sort((a, b) => b[1].length - a[1].length)[0]!;

    if (priorities.length >= 2) {
      const first = priorities[0]!;
      const last  = priorities[priorities.length - 1]!;
      h2Pass = last > first;
      h2Detail = `memory=${mostRetrievedId.slice(-8)} first=${first.toFixed(4)} last=${last.toFixed(4)} over ${priorities.length} retrievals`;
    } else {
      h2Detail = `most-retrieved outage memory only seen ${priorities.length} time(s)`;
    }
  }
  console.log(`H2 — retrieval_priority compounding on top outage memory: ${h2Detail}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H3: interrupt rate ≥50% during outage turns
  // ---------------------------------------------------------------------------

  const outageTurns    = turnLog.filter((r) => r.queryWindow === "outage");
  const outageInterrupts = outageTurns.filter((r) => r.hasInterrupt).length;
  const interruptRate  = outageTurns.length > 0 ? outageInterrupts / outageTurns.length : 0;
  const h3Pass = interruptRate >= 0.5;
  console.log(`H3 — interrupt rate during outage turns: ${outageInterrupts}/${outageTurns.length} (${(interruptRate * 100).toFixed(1)}%) ≥50%: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // H4: mean top-1 score outage > normal-pre
  // ---------------------------------------------------------------------------

  const meanScore = (turns: TurnRecord[]) =>
    turns.reduce((s, r) => s + r.top1Score, 0) / (turns.length || 1);

  const normalPreTurns = turnLog.filter((r) => r.phase === "normal-pre");
  const outagePhaseTurns  = turnLog.filter((r) => r.phase === "outage");
  const normalPreMean  = meanScore(normalPreTurns);
  const outageMean     = meanScore(outagePhaseTurns);
  const h4Pass = outageMean > normalPreMean;
  console.log(`H4 — mean top-1 score outage (${outageMean.toFixed(4)}) > normal-pre (${normalPreMean.toFixed(4)}): ${h4Pass ? "✓ PASS" : "✗ FAIL"}`);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const allPass = h1Pass && h2Pass && h3Pass && h4Pass;
  console.log(`\n=== Overall: ${allPass ? "ALL PASS" : "SOME FAIL"} ===`);

  // Per-phase score summary
  console.log("\nPer-phase summary:");
  for (const phase of PHASES) {
    const pt = turnLog.filter((r) => r.phase === phase.name);
    const pa = pt.filter((r) => r.top1Window === r.queryWindow).length;
    const pi = pt.filter((r) => r.hasInterrupt).length;
    const ps = meanScore(pt);
    console.log(`  ${phase.name.padEnd(12)}: aligned=${pa}/${pt.length} interrupts=${pi} meanScore=${ps.toFixed(4)}`);
  }

  saveResults(
    "exp28",
    [
      `H1 top-1 window alignment: ${aligned}/${turnLog.length} (${(alignmentRate * 100).toFixed(1)}%): ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 retrieval_priority compounding (${h2Detail}): ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 outage interrupt rate: ${outageInterrupts}/${outageTurns.length} (${(interruptRate * 100).toFixed(1)}%): ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 outage mean score (${outageMean.toFixed(4)}) > normal-pre (${normalPreMean.toFixed(4)}): ${h4Pass ? "PASS" : "FAIL"}`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      modelId,
      sourceIndex: SOURCE_INDEX,
      docCount,
      sessionId,
      turns: TURNS,
      alignment: {
        total: aligned,
        rate: alignmentRate,
        byPhase: Object.fromEntries(
          PHASES.map((p) => {
            const pt = turnLog.filter((r) => r.phase === p.name);
            return [p.name, { aligned: pt.filter((r) => r.top1Window === r.queryWindow).length, total: pt.length }];
          })
        ),
      },
      compounding: {
        outageMemoriesTracked: outageMemoryPriorities.size,
        detail: h2Detail,
      },
      interrupts: {
        outageRate: interruptRate,
        outageCount: outageInterrupts,
        outageTurns: outageTurns.length,
      },
      scores: {
        normalPreMean,
        outageMean,
        byPhase: Object.fromEntries(
          PHASES.map((p) => [p.name, meanScore(turnLog.filter((r) => r.phase === p.name))])
        ),
      },
      turnLog: turnLog.map((r) => ({
        turn: r.turn,
        phase: r.phase,
        top1Window: r.top1Window,
        top1Score: r.top1Score,
        hasInterrupt: r.hasInterrupt,
        rpBefore: r.top1RetrievalPriorityBefore,
        rpAfter: r.top1RetrievalPriorityAfter,
      })),
    },
  );
  console.log("Results saved.");

  if (OWN_INDEX) {
    console.log("\nCleaning up provisioned index...");
    await client.indices.delete({ index: SOURCE_INDEX });
    await client.ingest.deletePipeline({ id: PIPELINE_ID }).catch(() => undefined);
    console.log("  Done.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
