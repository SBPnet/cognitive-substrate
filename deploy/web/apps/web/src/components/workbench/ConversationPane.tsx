"use client";

import { useRef, useEffect, useState, type FormEvent } from "react";
import type { ConversationTurn } from "@/hooks/use-session";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  turns: ConversationTurn[];
  isSending: boolean;
  sessionId: string | null | undefined;
  onSend: (text: string) => void;
}

export function ConversationPane({ turns, isSending, sessionId, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId || isSending) return;
    setDraft("");
    onSend(text);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
          Conversation
        </h2>
        {sessionId && (
          <p className="text-xs text-zinc-500 font-mono mt-0.5 truncate">{sessionId}</p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {turns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500 text-sm">
              {sessionId
                ? "Send a message to begin the cognitive loop."
                : "Starting session…"}
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <MessageBubble key={turn.id} turn={turn} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 py-3 border-t border-zinc-700 bg-zinc-900"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={sessionId ? "Type a message…" : "Initialising…"}
          disabled={!sessionId || isSending}
          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!sessionId || isSending || !draft.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isSending ? <Spinner size={14} /> : null}
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ turn }: { turn: ConversationTurn }) {
  const isUser = turn.role === "user";
  const isFailed = turn.status === "failed";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : isFailed
              ? "bg-red-900/60 text-red-200 border border-red-700 rounded-bl-sm"
              : "bg-zinc-700 text-zinc-100 rounded-bl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap">{turn.text}</p>
        <div className="flex items-center gap-2 mt-1.5 opacity-60">
          <span className="text-[10px] font-mono">
            {new Date(turn.timestamp).toLocaleTimeString()}
          </span>
          {turn.confidence !== undefined && (
            <span className="text-[10px]">
              conf {Math.round(turn.confidence * 100)}%
            </span>
          )}
          {turn.riskScore !== undefined && turn.riskScore > 0.3 && (
            <span className="text-[10px] text-amber-400">
              risk {Math.round(turn.riskScore * 100)}%
            </span>
          )}
          {turn.status === "queued" && (
            <span className="text-[10px] text-indigo-300">queued</span>
          )}
        </div>
      </div>
    </div>
  );
}
