"use client";

import { useState, useCallback } from "react";
import {
  createSession,
  sendMessage,
  getSessionMemories,
  getSessionTrace,
  getAgentActivity,
  searchMemories,
  getSessionPolicy,
  type SessionDto,
  type MemoryDto,
  type TraceEventDto,
  type AgentActivityDto,
  type PolicySnapshotDto,
  type KafkaEventDto,
} from "@/lib/api-client";

const KAFKA_EVENT_CAP = 200;
const SESSION_TIMEOUT_MS = 10_000;

export interface ConversationTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  status?: "queued" | "complete" | "failed" | undefined;
  confidence?: number | undefined;
  riskScore?: number | undefined;
  eventId?: string | undefined;
}

export interface UseSessionResult {
  session: SessionDto | null;
  turns: ConversationTurn[];
  memories: MemoryDto[];
  traceEvents: TraceEventDto[];
  agentActivities: AgentActivityDto[];
  policy: PolicySnapshotDto | null;
  kafkaEvents: KafkaEventDto[];
  isInitialising: boolean;
  isSending: boolean;
  error: string | null;
  startSession: () => Promise<SessionDto | null>;
  loadSession: (sessionId: string) => Promise<void>;
  submit: (text: string, currentSessionId?: string) => Promise<void>;
  addAssistantTurn: (
    eventId: string,
    text: string,
    confidence: number,
    riskScore: number,
  ) => void;
  markTurnFailed: (eventId: string, errorMessage: string) => void;
  refreshMemories: (sid: string) => Promise<void>;
  queryMemories: (sid: string, query: string) => Promise<void>;
  refreshTrace: (sid: string) => Promise<void>;
  refreshAgentActivity: (sid: string) => Promise<void>;
  refreshPolicy: (sid: string) => Promise<void>;
  appendKafkaEvent: (event: KafkaEventDto) => void;
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [memories, setMemories] = useState<MemoryDto[]>([]);
  const [traceEvents, setTraceEvents] = useState<TraceEventDto[]>([]);
  const [agentActivities, setAgentActivities] = useState<AgentActivityDto[]>([]);
  const [policy, setPolicy] = useState<PolicySnapshotDto | null>(null);
  const [kafkaEvents, setKafkaEvents] = useState<KafkaEventDto[]>([]);
  const [isInitialising, setIsInitialising] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async () => {
    setIsInitialising(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
      const s = await createSession();
      setSession(s);
      return s;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = isTimeout
        ? "API server unreachable. Check that apps/api is running."
        : err instanceof Error
          ? err.message
          : "Failed to start session";
      setError(msg);
      return null;
    } finally {
      clearTimeout(timeout);
      setIsInitialising(false);
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    setIsInitialising(true);
    setError(null);
    try {
      setSession({ sessionId, createdAt: "", messageCount: 0, status: "active" });
      setTurns([]);
      await Promise.all([
        getSessionMemories(sessionId).then((r) => setMemories(r.memories as MemoryDto[])),
        getSessionTrace(sessionId).then((r) => setTraceEvents(r.events as TraceEventDto[])),
        getAgentActivity(sessionId).then((r) => setAgentActivities(r.activities as AgentActivityDto[])),
        getSessionPolicy(sessionId).then(setPolicy),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load session";
      setError(msg);
    } finally {
      setIsInitialising(false);
    }
  }, []);

  const submit = useCallback(
    async (text: string, currentSessionId?: string) => {
      const sid = currentSessionId ?? session?.sessionId;
      if (!sid) return;

      const userTurn: ConversationTurn = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
        timestamp: new Date().toISOString(),
        status: "queued",
      };
      setTurns((prev) => [...prev, userTurn]);
      setIsSending(true);

      try {
        const res = await sendMessage(sid, text);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === userTurn.id ? { ...t, eventId: res.eventId } : t,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Send failed";
        setError(msg);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === userTurn.id ? { ...t, status: "failed" } : t,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [session],
  );

  const addAssistantTurn = useCallback(
    (eventId: string, text: string, confidence: number, riskScore: number) => {
      const assistantTurn: ConversationTurn = {
        id: `assistant-${eventId}`,
        role: "assistant",
        text,
        timestamp: new Date().toISOString(),
        status: "complete",
        confidence,
        riskScore,
        eventId,
      };
      setTurns((prev) => [...prev, assistantTurn]);
    },
    [],
  );

  const markTurnFailed = useCallback((eventId: string, errorMessage: string) => {
    const failedTurn: ConversationTurn = {
      id: `assistant-${eventId}-failed`,
      role: "assistant",
      text: `Processing failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
      status: "failed",
      eventId,
    };
    setTurns((prev) => [...prev, failedTurn]);
  }, []);

  const refreshMemories = useCallback(async (sid: string) => {
    try {
      const result = await getSessionMemories(sid);
      setMemories(result.memories as MemoryDto[]);
    } catch {
      // non-fatal
    }
  }, []);

  const queryMemories = useCallback(async (sid: string, query: string) => {
    try {
      const result = await searchMemories(sid, query);
      setMemories(result.memories as MemoryDto[]);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshTrace = useCallback(async (sid: string) => {
    try {
      const result = await getSessionTrace(sid);
      setTraceEvents(result.events as TraceEventDto[]);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshAgentActivity = useCallback(async (sid: string) => {
    try {
      const result = await getAgentActivity(sid);
      setAgentActivities(result.activities as AgentActivityDto[]);
    } catch {
      // non-fatal
    }
  }, []);

  const refreshPolicy = useCallback(async (sid: string) => {
    try {
      const snapshot = await getSessionPolicy(sid);
      setPolicy(snapshot);
    } catch {
      // non-fatal
    }
  }, []);

  const appendKafkaEvent = useCallback((event: KafkaEventDto) => {
    setKafkaEvents((prev) => {
      const next = [...prev, event];
      return next.length > KAFKA_EVENT_CAP ? next.slice(next.length - KAFKA_EVENT_CAP) : next;
    });
  }, []);

  return {
    session,
    turns,
    memories,
    traceEvents,
    agentActivities,
    policy,
    kafkaEvents,
    isInitialising,
    isSending,
    error,
    startSession,
    loadSession,
    submit,
    addAssistantTurn,
    markTurnFailed,
    refreshMemories,
    queryMemories,
    refreshTrace,
    refreshAgentActivity,
    refreshPolicy,
    appendKafkaEvent,
  };
}
