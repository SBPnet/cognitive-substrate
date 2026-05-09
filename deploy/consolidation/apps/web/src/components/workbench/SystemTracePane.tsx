"use client";

import type { TraceEventDto } from "@/lib/api-client";

const STAGE_LABELS: Record<string, string> = {
  received: "Received",
  embedding: "Embedding",
  indexed: "Indexed",
  reasoning: "Reasoning",
  arbitrating: "Arbitrating",
  complete: "Complete",
  failed: "Failed",
};

const STAGE_COLORS: Record<string, string> = {
  received: "text-blue-400",
  embedding: "text-purple-400",
  indexed: "text-teal-400",
  reasoning: "text-amber-400",
  arbitrating: "text-orange-400",
  complete: "text-green-400",
  failed: "text-red-400",
};

interface Props {
  events: TraceEventDto[];
  sessionId: string | null | undefined;
  onRefresh: () => void;
}

export function SystemTracePane({ events, sessionId, onRefresh }: Props) {
  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
            System Trace
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{events.length} events</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={!sessionId}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
        >
          Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 font-mono text-xs">
        {events.length === 0 ? (
          <p className="text-zinc-500 px-1 pt-2">
            Pipeline events will appear here as messages are processed.
          </p>
        ) : (
          events.map((ev) => <TraceRow key={ev.eventId} event={ev} />)
        )}
      </div>
    </div>
  );
}

function TraceRow({ event }: { event: TraceEventDto }) {
  const label = STAGE_LABELS[event.stage] ?? event.stage;
  const color = STAGE_COLORS[event.stage] ?? "text-zinc-400";

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50 group">
      <span className="text-zinc-600 shrink-0 pt-0.5 text-[10px]">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
      <span className={`shrink-0 w-20 ${color}`}>{label}</span>
      <span className="text-zinc-400 truncate group-hover:whitespace-normal group-hover:truncate-none">
        {event.detail ?? "—"}
      </span>
    </div>
  );
}
