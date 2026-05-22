/**
 * Agent-layer types for multi-agent orchestration.
 * Each specialized agent conforms to a standard interface and operates
 * over a shared AgentContext assembled by the runtime.
 */

import type { ExperienceEvent } from "./experience.js";
import type { Goal } from "./goal.js";
import type { MemoryReference } from "./memory.js";
import type { PolicyState } from "./policy.js";

export type AgentType =
  | "planner"
  | "executor"
  | "critic"
  | "memory"
  | "world_model"
  | "meta_cognition";

/**
 * A single tool that the ToolExecutor can invoke. Agents receive the
 * capability manifest at context-build time so that planners can scope
 * proposals to available tools and critics can flag unavailable ones.
 *
 * `inputSchema` is a JSON Schema object (MCP wire format). When present it
 * is the authoritative parameter description. `parameters` is a flattened
 * convenience view kept for backwards compatibility with internal tools that
 * declare simple name/type/required tuples.
 */
export interface ToolCapability {
  readonly tool: string;
  readonly description: string;
  /** JSON Schema describing the tool's input (MCP-compatible). */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /** Flat parameter list. Use `inputSchema` for complex or nested schemas. */
  readonly parameters?: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly description?: string;
  }>;
}

/** Shared context injected into every agent execution. */
export interface AgentContext {
  readonly sessionId: string;
  readonly traceId: string;
  readonly input: ExperienceEvent;
  readonly memories: ReadonlyArray<MemoryReference>;
  readonly goals: ReadonlyArray<Goal>;
  readonly policy: PolicyState;
  /**
   * Tools available to the ToolExecutor in this deployment. Empty when
   * the executor has not declared its capability surface (e.g. stubs).
   */
  readonly capabilities: ReadonlyArray<ToolCapability>;
  /**
   * Result of the tool call from the previous reasoning step. Present only
   * during the follow-up reasoning pass so the model can formulate a final
   * response grounded in the tool output.
   */
  readonly toolResult?: {
    readonly tool: string;
    readonly output: string;
  };
}

/** The proposal produced by a single agent. */
export interface AgentResult {
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly traceId: string;
  readonly timestamp: string;
  readonly proposal: string;
  readonly reasoning?: string;
  readonly confidence: number;
  readonly riskScore: number;
  readonly retrievedMemories: ReadonlyArray<string>;
  /** Final score assigned by the arbitration engine. */
  score?: number;
  /** Whether this proposal was selected by the arbitrator. */
  selected?: boolean;
  /** Critique text added by the critic agent, if applicable. */
  critique?: string;
  readonly embedding?: ReadonlyArray<number>;
}

/** A runtime cognitive session managed by the orchestrator. */
export interface CognitiveSession {
  readonly sessionId: string;
  readonly traceId: string;
  readonly activeGoals: ReadonlyArray<Goal>;
  readonly policyState: PolicyState;
  readonly workingMemory: ReadonlyArray<MemoryReference>;
  readonly participatingAgents: ReadonlyArray<AgentType>;
  readonly createdAt: number;
}

/** Arbitration decision selecting the winning agent proposal. */
export interface ArbitrationDecision {
  readonly winnerId: string;
  readonly winnerType: AgentType;
  readonly winnerProposal: string;
  readonly confidence: number;
  readonly allScores: ReadonlyArray<{ agentId: string; score: number }>;
}

/** Activity trace written to the `agent_activity` OpenSearch index. */
export interface AgentActivityTrace {
  readonly traceId: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly agentType: AgentType;
  readonly inputSummary: string;
  readonly proposedAction: string;
  readonly confidence: number;
  readonly score: number;
  readonly selected: boolean;
  readonly critique?: string;
  readonly embedding?: ReadonlyArray<number>;
}
