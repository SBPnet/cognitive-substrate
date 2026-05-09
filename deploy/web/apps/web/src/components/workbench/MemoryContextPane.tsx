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
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
            Memory Context
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{memories.length} memories</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={!sessionId}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
        >
          Refresh
        </button>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2 px-4 py-2.5 border-b border-zinc-700">
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
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs hover:border-zinc-500 transition-colors">
      <p className="text-zinc-200 leading-relaxed line-clamp-3">{memory.summary}</p>
      <div className="flex items-center gap-3 mt-2 text-zinc-500">
        <span className="font-mono">{memory.index}</span>
        <span>
          imp{" "}
          <span
            className={importancePct >= 70 ? "text-green-400" : "text-zinc-400"}
          >
            {importancePct}%
          </span>
        </span>
        <span>
          score <span className="text-zinc-400">{scorePct}%</span>
        </span>
        {memory.lastRetrieved && (
          <span className="ml-auto">
            {new Date(memory.lastRetrieved).toLocaleDateString()}
          </span>
        )}
      </div>
      {memory.tags && memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {memory.tags.map((tag) => (
            <span
              key={tag}
              className="bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded text-[10px]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
