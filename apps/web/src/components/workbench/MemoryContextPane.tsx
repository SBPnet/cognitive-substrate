"use client";

import { useState, type FormEvent } from "react";
import type { MemoryDto } from "@/lib/api-client";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  memories: MemoryDto[];
  sessionId: string | null | undefined;
  onSearch: (query: string) => void;
  onRefresh: () => void;
}

export function MemoryContextPane({ memories, sessionId, onSearch, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim() || !sessionId) return;
    setIsSearching(true);
    onSearch(query.trim());
    setIsSearching(false);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2.5 border-b border-zinc-700/50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-0.5 h-4 rounded-full bg-teal-500" />
          <div>
            <h2 className="text-xs font-semibold text-zinc-200">Memory Context</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">{memories.length} memories</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={!sessionId}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 disabled:opacity-40 transition-colors"
          title="Refresh memories"
        >
          <RefreshIcon />
        </button>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2 px-4 py-2.5 border-b border-zinc-700/50">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search semantic memory…"
          disabled={!sessionId}
          className="flex-1 bg-zinc-800 border border-zinc-600 rounded-md px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!sessionId || isSearching || !query.trim()}
          className="px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          {isSearching ? <Spinner size={10} /> : null}
          Search
        </button>
      </form>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {memories.length === 0 ? (
          <p className="text-zinc-500 text-xs px-1 pt-2">
            No memories yet. Send a message to populate the memory context.
          </p>
        ) : (
          memories.map((m) => <MemoryCard key={m.memoryId} memory={m} />)
        )}
      </div>
    </div>
  );
}

function MemoryCard({ memory }: { memory: MemoryDto }) {
  const importancePct = Math.round(memory.importanceScore * 100);
  const scorePct = Math.round(memory.score * 100);

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs hover:border-zinc-600/60 transition-colors">
      <p className="text-zinc-200 leading-relaxed line-clamp-3">{memory.summary}</p>
      <div className="flex items-center gap-2 mt-2 text-zinc-500">
        <span className="font-mono text-[10px]">{memory.index}</span>
        <span className={`text-[10px] ${importancePct >= 70 ? "text-green-400" : "text-zinc-500"}`}>
          imp {importancePct}%
        </span>
        {memory.lastRetrieved && (
          <span className="ml-auto text-[10px]">
            {new Date(memory.lastRetrieved).toLocaleDateString()}
          </span>
        )}
      </div>
      {/* Score bar */}
      <div className="mt-2 h-0.5 rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full bg-indigo-500/60 transition-all duration-500"
          style={{ width: `${scorePct}%` }}
        />
      </div>
      {memory.tags && memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {memory.tags.map((tag) => (
            <span
              key={tag}
              className="bg-zinc-700/60 text-zinc-400 px-1.5 py-0.5 rounded-full text-[10px]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
