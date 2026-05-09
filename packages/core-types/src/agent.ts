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

/** Shared context injected into every agent execution. */
export interface AgentContext {
  readonly sessionId: string;
  readonly traceId: string;
  readonly input: ExperienceEvent;
  readonly memories: ReadonlyArray<MemoryReference>;
  readonly goals: ReadonlyArray<Goal>;
  readonly policy: PolicyState;
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
