"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSession } from "@/hooks/use-session";
import { useSessionSSE } from "@/hooks/use-sse";
import { ConversationPane } from "./ConversationPane";
import { MemoryContextPane } from "./MemoryContextPane";
import { PolicyPane } from "./PolicyPane";
import { AgentActivityPane } from "./AgentActivityPane";
import { KafkaFeedPane } from "./KafkaFeedPane";
import { SessionSidebar } from "./SessionSidebar";
import type { InteractionResponseDto, KafkaEventDto } from "@/lib/api-client";
import { Spinner } from "@/components/ui/spinner";

export function WorkbenchLayout() {
  const {
    session,
    turns,
    memories,
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
    refreshAgentActivity,
    refreshPolicy,
    appendKafkaEvent,
  } = useSession();

  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    void startSession();
  }, [startSession]);

  const handleResponse = useCallback(
    (response: InteractionResponseDto) => {
      if (response.status === "failed") {
        markTurnFailed(response.eventId, response.errorMessage ?? "Unknown error");
      } else {
        addAssistantTurn(
          response.eventId,
          response.responseText,
          response.confidence,
          response.riskScore,
          response.retrievedMemories ?? [],
          response.policySnapshot ?? null,
        );
      }

      const sid = sessionRef.current?.sessionId;
      if (sid) {
        void refreshAgentActivity(sid);
      }
    },
    [addAssistantTurn, markTurnFailed, refreshAgentActivity],
  );

  const handleKafkaEvent = useCallback(
    (event: KafkaEventDto) => {
      appendKafkaEvent(event);
    },
    [appendKafkaEvent],
  );

  useSessionSSE(session?.sessionId, { onResponse: handleResponse, onKafkaEvent: handleKafkaEvent });

  const handleSend = useCallback(
    (text: string) => {
      void submit(text, session?.sessionId);
    },
    [submit, session],
  );

  const handleRefreshMemories = useCallback(() => {
    if (session?.sessionId) void refreshMemories(session.sessionId);
  }, [session, refreshMemories]);

  const handleSearchMemories = useCallback(
    (query: string) => {
      if (session?.sessionId) void queryMemories(session.sessionId, query);
    },
    [session, queryMemories],
  );

  const handleRefreshAgentActivity = useCallback(() => {
    if (session?.sessionId) void refreshAgentActivity(session.sessionId);
  }, [session, refreshAgentActivity]);

  const handleRefreshPolicy = useCallback(() => {
    if (session?.sessionId) void refreshPolicy(session.sessionId);
  }, [session, refreshPolicy]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId);
    },
    [loadSession],
  );

  const handleNewSession = useCallback(() => {
    void startSession();
  }, [startSession]);

  if (isInitialising) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-400 gap-3">
        <Spinner size={20} />
        <span className="text-sm">Initialising session…</span>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-400 gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => void startSession()}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top gradient accent bar */}
      <div className="h-px bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 flex-shrink-0 opacity-60" />

      <div className="flex flex-1 overflow-hidden">
        {/* Session sidebar */}
        <div className="hidden lg:flex flex-shrink-0">
          <SessionSidebar
            activeSessionId={session?.sessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
          />
        </div>

        {/* Main content */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Top row: conversation + right panels */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Conversation pane */}
            <div className="flex flex-col w-full lg:w-[45%] xl:w-[40%] border-r border-zinc-700/50 min-h-0">
              <ConversationPane
                turns={turns}
                isSending={isSending}
                sessionId={session?.sessionId}
                onSend={handleSend}
              />
            </div>

            {/* Right column: memory + policy + agent activity */}
            <div className="hidden lg:flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex flex-col min-h-0" style={{ height: "40%" }}>
                <MemoryContextPane
                  memories={memories}
                  sessionId={session?.sessionId}
                  onSearch={handleSearchMemories}
                  onRefresh={handleRefreshMemories}
                />
              </div>

              <div className="flex flex-col border-t border-zinc-700/50 min-h-0" style={{ height: "25%" }}>
                <PolicyPane
                  policy={policy}
                  onRefresh={handleRefreshPolicy}
                />
              </div>

              <div className="flex flex-col border-t border-zinc-700/50 min-h-0" style={{ height: "35%" }}>
                <AgentActivityPane
                  activities={agentActivities}
                  onRefresh={handleRefreshAgentActivity}
                />
              </div>
            </div>
          </div>

          {/* Kafka event feed — full-width footer strip */}
          <div className="hidden lg:flex flex-col border-t border-zinc-700/50 flex-shrink-0" style={{ height: "180px" }}>
            <KafkaFeedPane events={kafkaEvents} />
          </div>
        </div>
      </div>
    </div>
  );
}
