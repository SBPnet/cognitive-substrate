/**
 * Agents-package type surface.
 *
 * This module declares the ports and structures used by the cognitive
 * loop and multi-agent runtime. Every external dependency the loop
 * needs (sessions, goals, policy, retrieval, reasoning, tools, policy
 * evaluation publishing) is expressed here as a thin interface so that
 * the orchestrator process and tests can plug in different
 * implementations without touching the loop logic.
 *
 * `ReasoningModel` and `ToolExecutor` are the two extension points most
 * commonly swapped: the default `EchoReasoningModel` and
 * `LocalToolExecutor` are deterministic stand-ins; production replaces
 * them with an LLM-backed reasoning model and a real tool executor
 * that talks to the workbench tool surface.
 */

import type {
  AgentContext,
  AgentResult,
  CognitiveSession,
  AgentActivityTrace,
  ArbitrationDecision,
  EventResult,
  ExperienceEvent,
  Goal,
  MemoryReference,
  PolicyState,
} from "@cognitive-substrate/core-types";
import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";

/** Persistence contract for cognitive sessions. */
export interface SessionManager {
  getOrCreate(event: ExperienceEvent, policy: PolicyState): Promise<CognitiveSession>;
  updateWorkingMemory(
    sessionId: string,
    memories: ReadonlyArray<MemoryReference>,
  ): Promise<void>;
}

/** Read-only goal feed used by the loop. */
export interface GoalProvider {
  listActiveGoals(sessionId: string): Promise<ReadonlyArray<Goal>>;
}

/** Read-only policy snapshot used by the loop. */
export interface PolicyProvider {
  getCurrentPolicy(): Promise<PolicyState>;
}

/**
 * Minimal retrieval surface needed by the loop. Wider methods on the
 * retrieval engine are not exposed here; the loop only needs vector +
 * BM25 hybrid recall against the writable memory indexes.
 */
export interface MemoryRetrieverPort {
  retrieve(input: {
    readonly queryText: string;
    readonly queryEmbedding?: ReadonlyArray<number>;
    readonly size?: number;
    readonly policy?: Partial<PolicyState>;
  }): Promise<{ readonly memories: ReadonlyArray<MemoryReference> }>;
}

/**
 * Pluggable reasoning model. Production deployments wire an LLM-backed
 * model here so that the loop can be swapped between providers by
 * changing environment variables only; the loop itself never depends
 * on which model implementation is in use.
 */
export interface ReasoningModel {
  reason(context: AgentContext): Promise<ReasoningDecision>;
}

/** Output of one `ReasoningModel.reason` call. */
export interface ReasoningDecision {
  readonly proposal: string;
  readonly reasoning?: string;
  readonly confidence: number;
  readonly riskScore: number;
  readonly action?: ActionRequest;
}

export interface ActionRequest {
  readonly tool: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Side-effect surface for action requests. */
export interface ToolExecutor {
  execute(action: ActionRequest, context: AgentContext): Promise<EventResult>;
}

/** Outbound publisher for policy evaluation deltas (typically Kafka). */
export interface PolicyEvaluationPublisher {
  publish(input: PolicyEvaluationInput): Promise<void>;
}

/** A single deterministic agent that proposes one AgentResult per call. */
export interface CognitiveAgent {
  run(context: AgentContext): Promise<AgentResult>;
}

/** Persistence contract for agent activity traces. */
export interface AgentActivityStore {
  record(trace: AgentActivityTrace): Promise<void>;
}

export interface MultiAgentRuntimeResult {
  readonly results: ReadonlyArray<AgentResult>;
  readonly decision: ArbitrationDecision;
}

/** Wiring bundle accepted by the `CognitiveLoop` constructor. */
export interface CognitiveLoopConfig {
  readonly sessionManager: SessionManager;
  readonly goalProvider: GoalProvider;
  readonly policyProvider: PolicyProvider;
  readonly memoryRetriever: MemoryRetrieverPort;
  readonly reasoningModel: ReasoningModel;
  readonly toolExecutor: ToolExecutor;
  readonly policyEvaluationPublisher: PolicyEvaluationPublisher;
}

/** Aggregate output of one cognitive cycle. */
export interface CognitiveLoopResult {
  readonly session: CognitiveSession;
  readonly context: AgentContext;
  readonly agentResult: AgentResult;
  readonly actionResult: EventResult;
  readonly policyEvaluation: PolicyEvaluationInput;
}
