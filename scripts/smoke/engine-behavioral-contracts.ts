import { AttentionEngine } from "../../packages/attention-engine/src/index.js";
import { AffectEngine } from "../../packages/affect-engine/src/index.js";
import { BudgetEngine } from "../../packages/budget-engine/src/index.js";
import { CausalEngine } from "../../packages/causal-engine/src/index.js";
import { CuriosityEngine } from "../../packages/curiosity-engine/src/index.js";
import { DecayEngine } from "../../packages/decay-engine/src/index.js";
import { DreamEngine } from "../../packages/dream-engine/src/index.js";
import { GroundingEngine } from "../../packages/grounding-engine/src/index.js";
import { ReflectionEngine } from "../../packages/metacog-engine/src/index.js";
import { NarrativeEngine } from "../../packages/narrative-engine/src/index.js";
import { SocialEngine } from "../../packages/social-engine/src/index.js";
import { TemporalEngine } from "../../packages/temporal-engine/src/index.js";
import type { ExperienceEvent, SemanticMemory } from "../../packages/core-types/src/index.js";

const now = new Date().toISOString();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function event(eventId: string, text: string, success = true): ExperienceEvent {
  return {
    eventId,
    timestamp: now,
    type: "user_input",
    context: { sessionId: "engine-contracts", traceId: eventId },
    input: { text, embedding: [], structured: {} },
    result: { success },
    evaluation: { selfAssessedQuality: success ? 0.9 : 0.2 },
    importanceScore: success ? 0.8 : 0.4,
    tags: ["engine-contract"],
  } as ExperienceEvent;
}

function memory(memoryId: string, summary: string): SemanticMemory {
  return {
    memoryId,
    createdAt: now,
    updatedAt: now,
    summary,
    generalization: summary,
    sourceEventIds: [memoryId],
    embedding: [0.1, 0.2, 0.3],
    importanceScore: 0.7,
    stabilityScore: 0.6,
    contradictionScore: memoryId.endsWith("2") ? 0.8 : 0.2,
    tags: ["engine-contract"],
  } as SemanticMemory;
}

function attentionContract(): void {
  const result = new AttentionEngine({ maxPrimaryItems: 1 }).route([
    { candidateId: "low", summary: "low", importance: 0.2, source: "memory", timestamp: now },
    { candidateId: "high", summary: "high", importance: 0.95, relevance: 1, urgency: 1, source: "goal", timestamp: now },
  ]);
  const focused = result.interrupts[0]?.candidateId ?? result.primary[0]?.candidateId;
  assert(focused === "high", "attention engine should focus highest-salience candidate");
}

function affectContract(): void {
  const engine = new AffectEngine();
  const state = engine.update({
    rewardPredictionError: 0.8,
    uncertainty: 0.7,
    novelty: 0.9,
    contradictionRisk: 0.1,
    sustainedSuccess: 0.8,
  });
  const coupling = engine.coupleAttention({
    candidateId: "novel",
    summary: "novel",
    importance: 0.5,
    novelty: 1,
    urgency: 0.8,
    risk: 0.1,
    source: "experience",
    timestamp: now,
  });
  assert(state.vector.curiosity > 0.5, "affect engine should increase curiosity on novelty");
  assert(coupling.adjustedCandidate.importance > 0.5, "affect coupling should boost candidate importance");
}

function budgetContract(): void {
  const engine = new BudgetEngine({ utilityThreshold: 0.2 });
  const approved = engine.decide({
    agentType: "executor",
    expectedUtility: 0.9,
    expectedCost: 0.1,
    requestedTokens: 100,
    requestedToolCalls: 1,
    uncertainty: 0.5,
  });
  engine.recordSpend("executor", 3_900, 4, 20_000);
  const rejected = engine.decide({
    agentType: "executor",
    expectedUtility: 0.9,
    expectedCost: 0.1,
    requestedTokens: 500,
    requestedToolCalls: 1,
  });
  assert(approved.approved, "budget engine should approve useful affordable work");
  assert(!rejected.approved, "budget engine should reject exhausted work");
}

function causalContract(): void {
  const engine = new CausalEngine();
  const model = engine.inferModel({
    variables: [
      { variableId: "lag", label: "lag", value: 10 },
      { variableId: "latency", label: "latency", value: 100 },
    ],
    events: [event("c1", "lag increased and latency increased")],
  });
  const result = engine.intervene(model, { variableId: "lag", value: 2 }, "latency");
  assert(model.edges.length > 0, "causal engine should infer co-occurrence edges");
  assert(result.effect > 0, "causal intervention should produce a positive effect");
}

function curiosityContract(): void {
  const assessment = new CuriosityEngine().assess([
    { stateId: "known", expectedInformationGain: 0.2, novelty: 0.1, uncertainty: 0.1, visitedCount: 10 },
    { stateId: "unknown", expectedInformationGain: 0.9, novelty: 0.9, uncertainty: 0.8, visitedCount: 0 },
  ]);
  assert(assessment.prioritizedStates[0]?.stateId === "unknown", "curiosity engine should prioritize high information gain");
  assert(assessment.experiments.length > 0, "curiosity engine should propose experiments");
}

function decayContract(): void {
  const plan = new DecayEngine().planForgetting(
    [
      { memory: { memoryId: "retain", importanceScore: 0.9, score: 0.9 }, retrievalCount: 10, ageDays: 1, strategicValue: 0.8 },
      { memory: { memoryId: "retire", importanceScore: 0.1, score: 0.1 }, retrievalCount: 0, ageDays: 90, contradictionScore: 0.9 },
    ] as any,
    [{ sourceMemoryId: "a", targetMemoryId: "b", relation: "related", strength: 0.01 }] as any,
  );
  assert(plan.decisions.some((decision) => decision.action === "retire"), "decay engine should retire contradictory low-retention memories");
  assert(plan.graphPruning.prunedLinks.length === 1, "decay engine should prune weak graph links");
}

function dreamContract(): void {
  const result = new DreamEngine().runCycle({
    memories: [memory("m1", "Kafka lag rose"), memory("m2", "Search latency rose")],
    maxScenarios: 1,
  });
  assert(result.scenarios.length === 1, "dream engine should synthesize paired replay scenarios");
  assert(result.scenarios[0]?.syntheticEvent.tags.includes("dream"), "dream scenario should emit dream-tagged synthetic events");
}

function groundingContract(): void {
  const engine = new GroundingEngine();
  const result = engine.ground([
    { sensorId: "kafka", metric: "consumer_lag", value: 80, unit: "messages", timestamp: now },
  ]);
  const feedback = engine.computePredictionFeedback("p1", 80, 40, "obs1");
  assert(result.events.length === 1, "grounding engine should materialize sensor readings");
  assert(feedback.error === 40, "grounding engine should compute prediction error");
}

async function metacogContract(): Promise<void> {
  const published: unknown[] = [];
  const result = await new ReflectionEngine({
    publisher: { publish: async (proposal) => { published.push(proposal); } },
  }).reflect({
    priorReflectionsInSession: 0,
    loopResult: {
      actionResult: { success: false },
      agentResult: { confidence: 0.9, riskScore: 0.9 },
      context: { memories: [] },
    },
  } as any);
  assert(result.proposal, "metacog engine should propose self-modification for miscalibrated high-risk failures");
  assert(published.length === 1, "metacog engine should publish proposals when configured");
}

async function narrativeContract(): Promise<void> {
  const published: unknown[] = [];
  const result = await new NarrativeEngine({
    publisher: { publish: async (update) => { published.push(update); } },
  }).updateIdentity({
    identityId: "identity-contract",
    timestamp: now,
    evidence: [
      { sourceMemoryId: "m1", curiosityDelta: 0.2, cautionDelta: 0, stabilityDelta: -0.05 },
    ],
  });
  assert(result.next.identityId === "identity-contract", "narrative engine should keep requested identity id");
  assert(published.length === 1, "narrative engine should publish identity updates when configured");
}

function socialContract(): void {
  const assessment = new SocialEngine().assess({
    subjectId: "user-1",
    events: [event("s1", "please explain why this failed"), event("s2", "this was successful")],
  });
  assert(assessment.intent.intent === "explanation_request", "social engine should infer explanation intent");
  assert(assessment.userModel.beliefs.length > 0, "social engine should retain observed beliefs");
}

function temporalContract(): void {
  const plan = new TemporalEngine().plan({
    now,
    computeBudget: 2,
    tasks: [
      { taskId: "later", description: "later", scale: "long", importance: 0.4, estimatedEffort: 1 },
      { taskId: "soon", description: "soon", scale: "short", importance: 0.9, estimatedEffort: 3, dueAt: "2026-05-10T01:00:00.000Z" },
    ],
    recentEvents: [event("t1", "recent event")],
  });
  assert(plan.orderedTasks[0]?.taskId === "soon", "temporal engine should prioritize urgent important work");
  assert(plan.subjectiveTime.inferenceSteps > 0, "temporal engine should allocate subjective inference steps");
}

attentionContract();
affectContract();
budgetContract();
causalContract();
curiosityContract();
decayContract();
dreamContract();
groundingContract();
await metacogContract();
await narrativeContract();
socialContract();
temporalContract();

process.stdout.write("[engine-behavioral-contracts] 12 orphan engine contracts passed\n");
