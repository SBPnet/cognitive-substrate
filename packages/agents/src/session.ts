import { randomUUID } from "node:crypto";
import type {
  CognitiveSession,
  ExperienceEvent,
  MemoryReference,
  PolicyState,
} from "@cognitive-substrate/core-types";
import type { SessionManager } from "./types.js";

export class InMemorySessionManager implements SessionManager {
  private readonly sessions = new Map<string, CognitiveSession>();

  async getOrCreate(
    event: ExperienceEvent,
    policy: PolicyState,
  ): Promise<CognitiveSession> {
    const existing = this.sessions.get(event.context.sessionId);
    if (existing) return existing;

    const session: CognitiveSession = {
      sessionId: event.context.sessionId,
      traceId: event.context.traceId ?? randomUUID(),
      activeGoals: [],
      policyState: policy,
      workingMemory: [],
      participatingAgents: ["planner", "executor"],
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async updateWorkingMemory(
    sessionId: string,
    memories: ReadonlyArray<MemoryReference>,
  ): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (!current) return;

    this.sessions.set(sessionId, {
      ...current,
      workingMemory: memories,
    });
  }
}

export class EmptyGoalProvider {
  async listActiveGoals(): Promise<[]> {
    return [];
  }
}
