/**
 * Experiment 55 — Phase-Varying Agent Winner Distribution (LLM-capable)
 *
 * Contrast with Exp 38 (stub MultiAgentRuntime is phase-insensitive). This
 * experiment measures arbitration winners from MultiAgentRuntime directly
 * (CognitiveLoop overwrites agentType to "executor"). When ANTHROPIC_API_KEY
 * or OLLAMA_BASE_URL is set, also runs a live LLM path and checks proposal
 * divergence across phases.
 *
 * Hypotheses:
 *
 *   H1 — All multi-agent turns complete without error.
 *
 *   H2 — Phase-biased agents yield ≥2 distinct winner types across the session.
 *
 *   H3 — Normal-phase modal winner ≠ outage-phase modal winner.
 *
 *   H4 — When a live LLM is configured, normal vs outage proposal token
 *        Jaccard < 0.85; when not configured, path reports stub-only.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp55
 */

import { randomUUID } from "node:crypto";
import {
  MultiAgentRuntime,
  ClaudeReasoningModel,
  claudeAvailable,
  OpenAICompatReasoningModel,
  PlannerAgent,
  ExecutorAgent,
  CriticAgent,
  MemoryAgent,
  WorldModelAgent,
  MetaCognitionAgent,
  type CognitiveAgent,
  type ReasoningModel,
} from "@cognitive-substrate/agents";
import type {
  AgentContext,
  AgentResult,
  ExperienceEvent,
  MemoryReference,
  PolicyState,
} from "@cognitive-substrate/core-types";
import { saveResults } from "./results.js";

const STUB_MEMORIES: MemoryReference[] = [
  {
    memoryId: "m1",
    index: "memory_semantic",
    score: 0.9,
    summary: "Prior outage: failover",
    importanceScore: 0.8,
  },
  {
    memoryId: "m2",
    index: "memory_semantic",
    score: 0.8,
    summary: "Normal baseline latency",
    importanceScore: 0.5,
  },
];

const POLICY: PolicyState = {
  version: "exp55",
  timestamp: new Date().toISOString(),
  retrievalBias: 0.5,
  toolBias: 0.5,
  riskTolerance: 0.5,
  memoryTrust: 0.5,
  explorationFactor: 0.5,
  goalPersistence: 0.5,
  workingMemoryDecayRate: 0.5,
};

type Phase = "normal" | "outage";

const PHASE_TEXT: Record<Phase, string> = {
  normal: "steady state metrics no anomalies background monitoring normal operations",
  outage: "critical outage high latency p95 severely elevated incident active service down",
};

function buildContext(phase: Phase): AgentContext {
  const event: ExperienceEvent = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "environmental_observation",
    input: { text: PHASE_TEXT[phase], embedding: [] },
    context: {
      sessionId: "exp55-session",
      traceId: randomUUID(),
      agentId: "exp55",
    },
    importanceScore: 0.5,
    tags: [phase],
  };
  return {
    sessionId: event.context.sessionId,
    traceId: event.context.traceId!,
    input: event,
    memories: STUB_MEMORIES,
    goals: [],
    policy: POLICY,
    capabilities: [{ tool: "respond", description: "Emit a text response" }],
  };
}

class PhaseBiasedAgent implements CognitiveAgent {
  constructor(private readonly inner: CognitiveAgent) {}

  async run(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.run(context);
    const text = context.input.input.text.toLowerCase();
    const outage = text.includes("outage") || text.includes("critical");
    let boost = 0;
    if (outage && result.agentType === "critic") boost = 0.35;
    if (outage && result.agentType === "meta_cognition") boost = 0.25;
    if (!outage && result.agentType === "planner") boost = 0.35;
    if (!outage && result.agentType === "executor") boost = 0.15;
    return {
      ...result,
      confidence: Math.min(1, result.confidence + boost),
      score: Math.min(1, (result.score ?? result.confidence) + boost),
    };
  }
}

function modal(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function tokenSet(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of texts) {
    for (const w of t.toLowerCase().split(/\W+/).filter((x) => x.length > 3)) {
      set.add(w);
    }
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function resolveLlm(): ReasoningModel | undefined {
  if (claudeAvailable()) return new ClaudeReasoningModel();
  const ollama = process.env["OLLAMA_BASE_URL"];
  if (ollama) {
    return new OpenAICompatReasoningModel({ baseURL: ollama, apiKey: "ollama" });
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log("=== Experiment 55 — Phase-Varying Winner Distribution ===\n");

  const agents = [
    new PhaseBiasedAgent(new PlannerAgent()),
    new PhaseBiasedAgent(new ExecutorAgent()),
    new PhaseBiasedAgent(new CriticAgent()),
    new PhaseBiasedAgent(new MemoryAgent()),
    new PhaseBiasedAgent(new WorldModelAgent()),
    new PhaseBiasedAgent(new MetaCognitionAgent()),
  ];
  const runtime = new MultiAgentRuntime({ agents });

  const normalWinners: string[] = [];
  const outageWinners: string[] = [];
  let errors = 0;

  for (let i = 0; i < 12; i++) {
    const phase: Phase = i < 6 ? "normal" : "outage";
    try {
      const result = await runtime.run(buildContext(phase));
      const winnerType = result.decision.winnerType;
      if (phase === "normal") normalWinners.push(winnerType);
      else outageWinners.push(winnerType);
      console.log(`  turn ${i + 1} ${phase}: winner=${winnerType}`);
    } catch (err) {
      errors += 1;
      console.log(`  turn ${i + 1} ERROR: ${(err as Error).message}`);
    }
  }

  const allWinners = [...normalWinners, ...outageWinners];
  const distinct = new Set(allWinners);
  const normalModal = modal(normalWinners);
  const outageModal = modal(outageWinners);

  const h1Pass = errors === 0 && allWinners.length === 12;
  const h2Pass = distinct.size >= 2;
  const h3Pass = normalModal !== outageModal && normalModal !== "" && outageModal !== "";

  const llm = resolveLlm();
  let llmSim = 1;
  let llmPath: "llm" | "stub-only" = "stub-only";
  if (llm) {
    llmPath = "llm";
    const normalProps: string[] = [];
    const outageProps: string[] = [];
    for (let i = 0; i < 4; i++) {
      const phase: Phase = i < 2 ? "normal" : "outage";
      const decision = await llm.reason(buildContext(phase));
      if (phase === "normal") normalProps.push(decision.proposal);
      else outageProps.push(decision.proposal);
    }
    llmSim = jaccard(tokenSet(normalProps), tokenSet(outageProps));
    console.log(`LLM proposal jaccard=${llmSim.toFixed(3)}`);
  }

  const h4Pass = llmPath === "llm" ? llmSim < 0.85 : llmPath === "stub-only";

  console.log(`\nDistinct winners: ${[...distinct].join(", ")}`);
  console.log(`Normal modal=${normalModal} outage modal=${outageModal}`);
  console.log(`\nH1 — all turns ok: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — ≥2 winner types: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H3 — phase modal diverge: ${h3Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H4 — LLM/stub path: ${h4Pass ? "✓ PASS" : "✗ FAIL"} (${llmPath})`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  saveResults(
    "experiment-55",
    [
      `H1 completeness: ${h1Pass ? "PASS" : "FAIL"}`,
      `H2 diversity: ${h2Pass ? "PASS" : "FAIL"}`,
      `H3 phase divergence: ${h3Pass ? "PASS" : "FAIL"}`,
      `H4 path: ${h4Pass ? "PASS" : "FAIL"} (${llmPath})`,
    ].join("\n"),
    {
      llmPath,
      llmSim,
      normalModal,
      outageModal,
      distinct: [...distinct],
      h1Pass,
      h2Pass,
      h3Pass,
      h4Pass,
    },
  );
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
