"use client";

import { useEffect, useState, useRef } from "react";
import type { SessionDto } from "@/lib/api-client";
import { listSessions, renameSession } from "@/lib/api-client";

interface Props {
  activeSessionId: string | null | undefined;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionSidebar({ activeSessionId, onSelectSession, onNewSession }: Props) {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listSessions(50).then((r) => setSessions(r.sessions));
  }, [activeSessionId]);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  async function commitRename(sessionId: string) {
    const name = editValue.trim();
    setEditingId(null);
    if (!name) return;
    try {
      const updated = await renameSession(sessionId, name);
      setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, name: updated.name } : s)));
    } catch {
      // non-fatal
    }
  }

  function startEdit(s: SessionDto) {
    setEditingId(s.sessionId);
    setEditValue(s.name ?? "");
  }

  function displayName(s: SessionDto): string {
    if (s.name) return s.name;
    return `Session ${s.sessionId.slice(0, 8)}`;
  }

  return (
    <div className="flex flex-col h-full w-[200px] border-r border-zinc-700/50 bg-zinc-950/80 backdrop-blur-sm flex-shrink-0">
      <div className="px-3 py-2.5 border-b border-zinc-700/50 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest">Sessions</span>
        <button
          onClick={onNewSession}
          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
          title="New session"
        >
          <PlusIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && (
          <p className="text-[10px] text-zinc-600 px-3 py-2">No sessions yet.</p>
        )}
        {sessions.map((s) => {
          const isActive = s.sessionId === activeSessionId;
          return (
            <div
              key={s.sessionId}
              className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? "bg-indigo-600/20 border border-indigo-500/30"
                  : "hover:bg-zinc-800/50 border border-transparent"
              }`}
              onClick={() => {
                if (editingId !== s.sessionId) onSelectSession(s.sessionId);
              }}
            >
              {editingId === s.sessionId ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => void commitRename(s.sessionId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(s.sessionId);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-zinc-800 border border-indigo-500/50 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                />
              ) : (
                <span
                  className={`flex-1 min-w-0 text-[11px] truncate ${isActive ? "text-zinc-200" : "text-zinc-400"}`}
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit(s); }}
                >
                  {displayName(s)}
                </span>
              )}
              {editingId !== s.sessionId && (
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(s); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-600 hover:text-zinc-300 transition-all"
                  title="Rename"
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
