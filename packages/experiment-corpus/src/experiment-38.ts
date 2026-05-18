/**
 * Experiment 38 — CognitiveLoop + MultiAgentRuntime: 50-Turn End-to-End
 *
 * Prior experiments validated each cognitive component in isolation or in small
 * pipeline sequences. Experiment 32 ran a full pipeline but used direct engine
 * calls rather than the canonical CognitiveLoop + MultiAgentRuntime wiring
 * that the orchestrator uses in production.
 *
 * This experiment runs 50 turns through the production-equivalent wiring:
 *
 *   CognitiveLoop.process(event)
 *     → InMemorySessionManager   (session state)
 *     → EmptyGoalProvider        (no goals — isolates loop mechanics)
 *     → StaticPolicyProvider     (constant policy snapshot)
 *     → StubMemoryRetriever      (returns 3 dummy MemoryReferences)
 *     → MultiAgentReasoningModel (6-agent debate via MultiAgentRuntime)
 *     → LocalToolExecutor        (no-op tool calls)
 *     → CapturingPublisher       (collects PolicyEvaluationInputs)
 *
 * The 50-turn session spans two phases (normal turns 1–25, outage turns 26–50)
 * so we can verify phase-sensitive behaviour in the multi-agent runtime.
 *
 * Four hypotheses:
 *
 *   H1 — All 50 turns complete without error: the full wiring produces a
 *        CognitiveLoopResult for every event, confirming no plumbing breaks.
 *
 *   H2 — Multi-agent winner is consistent: across all 50 turns, the winning
 *        agent type is always "planner" or "executor" (the two highest-scoring
 *        deterministic agents), never "meta" or "world-model".
 *
 *   H3 — Session working memory is updated each turn: after each
 *        CognitiveLoop.process call, the session's workingMemory contains
 *        exactly 3 references (the stub retriever always returns 3).
 *
 *   H4 — PolicyEvaluationInput rewardDelta is positive when confidence > 0.6:
 *        the loop's decision-scoring function should produce a positive reward
 *        when the agent's confidence is high and action succeeded.
 *
 * This experiment requires no live OpenSearch — all dependencies are stubs.
 *
 * Usage:
 *   pnpm --filter @cognitive-substrate/experiment-corpus exp38
 */

import { randomUUID } from "node:crypto";
import {
  CognitiveLoop,
  MultiAgentRuntime,
  MultiAgentReasoningModel,
  InMemorySessionManager,
  EmptyGoalProvider,
  NoopPolicyEvaluationPublisher,
  LocalToolExecutor,
  EchoReasoningModel,
} from "@cognitive-substrate/agents";
import { saveResults } from "./results.js";
import type {
  ExperienceEvent,
  MemoryReference,
  PolicyState,
} from "@cognitive-substrate/core-types";
import type {
  CognitiveLoopResult,
  PolicyEvaluationPublisher,
  MemoryRetrieverPort,
  PolicyProvider,
} from "@cognitive-substrate/agents";
import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const STUB_MEMORIES: MemoryReference[] = [
  { memoryId: "m1", index: "memory_semantic",   score: 0.92, summary: "Previous outage: postgres failover", importanceScore: 0.8 },
  { memoryId: "m2", index: "memory_semantic",   score: 0.81, summary: "Normal latency baseline 12 ms",       importanceScore: 0.5 },
  { memoryId: "m3", index: "experience_events", score: 0.74, summary: "Recovery runbook step 3",             importanceScore: 0.7 },
];

class StubMemoryRetriever implements MemoryRetrieverPort {
  async retrieve(): Promise<{ memories: MemoryReference[] }> {
    return { memories: STUB_MEMORIES };
  }
}

class StaticPolicyProvider implements PolicyProvider {
  private readonly policy: PolicyState;
  constructor(policy: PolicyState) { this.policy = policy; }
  async getCurrentPolicy(): Promise<PolicyState> { return this.policy; }
}

class CapturingPublisher implements PolicyEvaluationPublisher {
  readonly captured: PolicyEvaluationInput[] = [];
  async publish(input: PolicyEvaluationInput): Promise<void> {
    this.captured.push(input);
  }
}

// ---------------------------------------------------------------------------
// Event factory
// ---------------------------------------------------------------------------

type Phase = "normal" | "outage";

const PHASE_TEXT: Record<Phase, string> = {
  normal: "steady state metrics no anomalies background monitoring normal operations",
  outage: "critical outage high latency p95 severely elevated incident active service down",
};

function buildEvent(turn: number, phase: Phase): ExperienceEvent {
  return {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    type: "environmental_observation",
    input: {
      text: PHASE_TEXT[phase],
      embedding: [],
    },
    context: {
      sessionId: "exp38-session",
      traceId: randomUUID(),
      agentId: "exp38",
    },
    importanceScore: 0.5,
    tags: [phase],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 38: CognitiveLoop + MultiAgentRuntime 50-Turn End-to-End ===\n");

  const TURNS = 50;

  const policy: PolicyState = {
    explorationFactor: 0.5,
    riskTolerance: 0.6,
    retrievalBias: 0.5,
    toolBias: 0.3,
    memoryTrust: 0.7,
    goalPersistence: 0.5,
    workingMemoryDecayRate: 0.1,
    version: "policy-v1",
    timestamp: new Date().toISOString(),
  };

  const publisher    = new CapturingPublisher();
  const sessionMgr   = new InMemorySessionManager();
  const runtime      = new MultiAgentRuntime();
  const reasoning    = new MultiAgentReasoningModel(runtime);

  const loop = new CognitiveLoop({
    sessionManager:          sessionMgr,
    goalProvider:            new EmptyGoalProvider(),
    policyProvider:          new StaticPolicyProvider(policy),
    memoryRetriever:         new StubMemoryRetriever(),
    reasoningModel:          reasoning,
    toolExecutor:            new LocalToolExecutor(),
    policyEvaluationPublisher: publisher,
  });

  const results: CognitiveLoopResult[] = [];
  const errors: string[] = [];

  for (let turn = 1; turn <= TURNS; turn++) {
    const phase: Phase = turn <= 25 ? "normal" : "outage";
    const event = buildEvent(turn, phase);
    try {
      const result = await loop.process(event);
      results.push(result);
    } catch (err) {
      errors.push(`turn ${turn}: ${String(err)}`);
    }
    if (turn % 10 === 0) process.stdout.write(`  turn ${turn}/${TURNS}\n`);
  }

  // ---------------------------------------------------------------------------
  // Evaluate hypotheses
  // ---------------------------------------------------------------------------

  // H1: all turns complete
  const h1Pass = results.length === TURNS && errors.length === 0;

  // H2: winning agent type is always planner or executor
  const ACCEPTABLE_WINNERS = new Set(["planner", "executor"]);
  const winnerTypes = results.map((r) => r.agentResult.agentType);
  const badWinners  = winnerTypes.filter((t) => !ACCEPTABLE_WINNERS.has(t));
  const h2Pass = badWinners.length === 0;

  // H3: working memory has exactly 3 items after each turn
  const wrongMemoryCounts = results.filter(
    (r) => r.session.workingMemory.length !== STUB_MEMORIES.length,
  ).length;
  const h3Pass = wrongMemoryCounts === 0;

  // H4: positive rewardDelta when agent confidence > 0.6
  const highConfidenceTurns = results.filter((r) => r.agentResult.confidence > 0.6);
  const positiveReward      = highConfidenceTurns.filter(
    (r) => publisher.captured.find((p) => p.sourceExperienceId === r.context.input.eventId)?.rewardDelta ?? 0 > 0,
  );
  const h4Pass = highConfidenceTurns.length > 0 && positiveReward.length / highConfidenceTurns.length >= 0.5;

  // Stats
  const winnerDist: Record<string, number> = {};
  for (const t of winnerTypes) { winnerDist[t] = (winnerDist[t] ?? 0) + 1; }
  const meanConfidence = results.reduce((s, r) => s + r.agentResult.confidence, 0) / results.length;
  const meanReward     = publisher.captured.reduce((s, p) => s + p.rewardDelta, 0) / publisher.captured.length;

  console.log(`\nCompleted turns: ${results.length}/${TURNS}  errors: ${errors.length}`);
  console.log(`Winner distribution: ${JSON.stringify(winnerDist)}`);
  console.log(`Mean confidence: ${meanConfidence.toFixed(4)}  mean reward: ${meanReward.toFixed(4)}`);
  console.log(`Wrong memory counts: ${wrongMemoryCounts}`);
  console.log(`High-confidence turns: ${highConfidenceTurns.length}  positive reward: ${positiveReward.length}`);

  console.log(`\nH1 — all 50 turns complete: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`H2 — winner always planner/executor: ${h2Pass ? "✓ PASS" : "✗ FAIL"} (bad: ${badWinners.join(",")})`);
  console.log(`H3 — working memory = 3 every turn: ${h3Pass ? "✓ PASS" : "✗ FAIL"} (wrong: ${wrongMemoryCounts})`);
  console.log(`H4 — positive reward when confidence>0.6: ${h4Pass ? "✓ PASS" : "✗ FAIL"} (${positiveReward.length}/${highConfidenceTurns.length})`);
  console.log(`\n=== Overall: ${h1Pass && h2Pass && h3Pass && h4Pass ? "ALL PASS" : "SOME FAIL"} ===`);

  if (errors.length) {
    console.log("\nErrors:");
    for (const e of errors) console.log(`  ${e}`);
  }

  saveResults(
    "exp38",
    [
      `H1 all 50 turns: ${h1Pass ? "PASS" : "FAIL"} (errors=${errors.length})`,
      `H2 winner planner/executor: ${h2Pass ? "PASS" : "FAIL"} (dist=${JSON.stringify(winnerDist)})`,
      `H3 working memory=3: ${h3Pass ? "PASS" : "FAIL"} (wrongCounts=${wrongMemoryCounts})`,
      `H4 reward>0 when conf>0.6: ${h4Pass ? "PASS" : "FAIL"} (${positiveReward.length}/${highConfidenceTurns.length})`,
    ].join("; "),
    {
      hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
      completedTurns: results.length,
      errorCount: errors.length,
      winnerDistribution: winnerDist,
      meanConfidence,
      meanReward,
      badWinners,
    },
  );
  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
