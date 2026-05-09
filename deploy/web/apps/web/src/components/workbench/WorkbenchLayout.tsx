"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSession } from "@/hooks/use-session";
import { useSessionSSE } from "@/hooks/use-sse";
import { ConversationPane } from "./ConversationPane";
import { MemoryContextPane } from "./MemoryContextPane";
import { SystemTracePane } from "./SystemTracePane";
import { AgentActivityPane } from "./AgentActivityPane";
import { CollectorControlPane } from "./CollectorControlPane";
import type { InteractionResponseDto } from "@/lib/api-client";
import { Spinner } from "@/components/ui/spinner";

export function WorkbenchLayout() {
  const {
    session,
    turns,
    memories,
    traceEvents,
    agentActivities,
    isInitialising,
    isSending,
    error,
    startSession,
    submit,
    addAssistantTurn,
    markTurnFailed,
    refreshMemories,
    queryMemories,
    refreshTrace,
    refreshAgentActivity,
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
        );
      }

      const sid = sessionRef.current?.sessionId;
      if (sid) {
        void refreshMemories(sid);
        void refreshTrace(sid);
        void refreshAgentActivity(sid);
      }
    },
    [addAssistantTurn, markTurnFailed, refreshAgentActivity, refreshMemories, refreshTrace],
  );

  useSessionSSE(session?.sessionId, { onResponse: handleResponse });

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

  const handleRefreshTrace = useCallback(() => {
    if (session?.sessionId) void refreshTrace(session.sessionId);
  }, [session, refreshTrace]);

  const handleRefreshAgentActivity = useCallback(() => {
    if (session?.sessionId) void refreshAgentActivity(session.sessionId);
  }, [session, refreshAgentActivity]);

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
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Conversation pane — left, takes 45% on wide screens */}
      <div className="flex flex-col w-full lg:w-[45%] xl:w-[40%] border-r border-zinc-700">
        <ConversationPane
          turns={turns}
          isSending={isSending}
          sessionId={session?.sessionId}
          onSend={handleSend}
        />
      </div>

      {/* Right column — memory context + system trace */}
      <div className="hidden lg:flex flex-col flex-1 min-w-0">
        {/* Memory context — top */}
        <div className="flex flex-col" style={{ height: "34%" }}>
          <MemoryContextPane
            memories={memories}
            sessionId={session?.sessionId}
            onSearch={handleSearchMemories}
            onRefresh={handleRefreshMemories}
          />
        </div>

        <div className="flex flex-col border-t border-zinc-700" style={{ height: "22%" }}>
          <AgentActivityPane
            activities={agentActivities}
            onRefresh={handleRefreshAgentActivity}
          />
        </div>

        <div className="flex flex-col border-t border-zinc-700" style={{ height: "22%" }}>
          <SystemTracePane
            events={traceEvents}
            sessionId={session?.sessionId}
            onRefresh={handleRefreshTrace}
          />
        </div>

        <div className="flex flex-col border-t border-zinc-700" style={{ height: "22%" }}>
          <CollectorControlPane />
        </div>
      </div>
    </div>
  );
}
