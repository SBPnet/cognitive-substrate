"use client";

export interface AgentActivityEntry {
  traceId: string;
  timestamp: string;
  agentType: string;
  inputSummary: string;
  proposedAction: string;
  confidence: number;
  score: number;
  selected: boolean;
  critique?: string | undefined;
}

interface Props {
  activities: AgentActivityEntry[];
  onRefresh?: () => void;
}

const AGENT_COLORS: Record<string, string> = {
  planner: "text-indigo-400",
  executor: "text-teal-400",
  critic: "text-amber-400",
  memory: "text-purple-400",
  world_model: "text-blue-400",
  meta_cognition: "text-pink-400",
};

export function AgentActivityPane({ activities, onRefresh }: Props) {
  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2.5 border-b border-zinc-700/50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-0.5 h-4 rounded-full bg-indigo-500" />
          <div>
            <h2 className="text-xs font-semibold text-zinc-200">Agent Activity</h2>
            <p className="text-[10px] text-zinc-500 mt-0.5">{activities.length} traces</p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
            title="Refresh agent activity"
          >
            <RefreshIcon />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {activities.length === 0 ? (
          <div className="px-1 pt-2">
            <p className="text-zinc-500 text-xs">No agent traces yet for this session.</p>
          </div>
        ) : (
          activities.map((a) => (
            <AgentTrace key={`${a.traceId}-${a.agentType}`} entry={a} />
          ))
        )}
      </div>
    </div>
  );
}

function AgentTrace({ entry }: { entry: AgentActivityEntry }) {
  const color = AGENT_COLORS[entry.agentType] ?? "text-zinc-400";
  const confPct = Math.round(entry.confidence * 100);

  return (
    <div
      className={`border rounded-lg px-3 py-2.5 text-xs flex gap-2.5 ${
        entry.selected
          ? "border-indigo-500/40 bg-indigo-950/20"
          : "border-zinc-700/50 bg-zinc-800/40"
      }`}
    >
      <div className={`w-0.5 rounded-full flex-shrink-0 mt-0.5 ${color.replace("text-", "bg-")}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`font-semibold ${color} capitalize`}>
            {entry.agentType.replace("_", " ")}
          </span>
          {entry.selected && (
            <span className="bg-indigo-600/30 text-indigo-300 px-1.5 py-0.5 rounded-full text-[10px]">
              selected
            </span>
          )}
          <span className="ml-auto text-zinc-500 font-mono">{confPct}%</span>
        </div>
        <p className="text-zinc-300 line-clamp-2">{entry.proposedAction}</p>
        {entry.critique && (
          <p className="text-amber-400/70 mt-1 line-clamp-1">{entry.critique}</p>
        )}
      </div>
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
