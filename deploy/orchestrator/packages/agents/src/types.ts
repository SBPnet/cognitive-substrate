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

export interface SessionManager {
  getOrCreate(event: ExperienceEvent, policy: PolicyState): Promise<CognitiveSession>;
  updateWorkingMemory(
    sessionId: string,
    memories: ReadonlyArray<MemoryReference>,
  ): Promise<void>;
}

export interface GoalProvider {
  listActiveGoals(sessionId: string): Promise<ReadonlyArray<Goal>>;
}

export interface PolicyProvider {
  getCurrentPolicy(): Promise<PolicyState>;
}

export interface MemoryRetrieverPort {
  retrieve(input: {
    readonly queryText: string;
    readonly queryEmbedding?: ReadonlyArray<number>;
    readonly size?: number;
    readonly policy?: Partial<PolicyState>;
  }): Promise<{ readonly memories: ReadonlyArray<MemoryReference> }>;
}

export interface ReasoningModel {
  reason(context: AgentContext): Promise<ReasoningDecision>;
}

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

export interface ToolExecutor {
  execute(action: ActionRequest, context: AgentContext): Promise<EventResult>;
}

export interface PolicyEvaluationPublisher {
  publish(input: PolicyEvaluationInput): Promise<void>;
}

export interface CognitiveAgent {
  run(context: AgentContext): Promise<AgentResult>;
}

export interface AgentActivityStore {
  record(trace: AgentActivityTrace): Promise<void>;
}

export interface MultiAgentRuntimeResult {
  readonly results: ReadonlyArray<AgentResult>;
  readonly decision: ArbitrationDecision;
}

export interface CognitiveLoopConfig {
  readonly sessionManager: SessionManager;
  readonly goalProvider: GoalProvider;
  readonly policyProvider: PolicyProvider;
  readonly memoryRetriever: MemoryRetrieverPort;
  readonly reasoningModel: ReasoningModel;
  readonly toolExecutor: ToolExecutor;
  readonly policyEvaluationPublisher: PolicyEvaluationPublisher;
}

export interface CognitiveLoopResult {
  readonly session: CognitiveSession;
  readonly context: AgentContext;
  readonly agentResult: AgentResult;
  readonly actionResult: EventResult;
  readonly policyEvaluation: PolicyEvaluationInput;
}
