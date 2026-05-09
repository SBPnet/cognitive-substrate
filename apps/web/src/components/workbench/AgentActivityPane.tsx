"use client";

/**
 * Multi-agent activity timeline — Roadmap Stages 6-7.
 *
 * Renders the per-agent reasoning traces stored in the `agent_activity`
 * OpenSearch index (planner, critic, executor, memory, world-model).
 * Shows the arbitration winner and per-agent confidence scores once
 * packages/agents multi-agent-runtime populates that index.
 *
 * Wire into WorkbenchLayout once Stage 6 ships.
 */

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
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
            Agent Activity
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{activities.length} traces</p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Refresh
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {activities.length === 0 ? (
          <div className="px-1 pt-2">
            <p className="text-zinc-500 text-xs">
              Multi-agent traces available from Stage 6.
            </p>
            <p className="text-zinc-600 text-xs mt-1">
              Planner, critic, executor, memory, and world-model proposals will
              appear here alongside the arbitration decision.
            </p>
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
      className={`bg-zinc-800 border rounded-lg px-3 py-2.5 text-xs ${
        entry.selected
          ? "border-indigo-500/50 bg-indigo-900/10"
          : "border-zinc-700"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`font-semibold ${color} capitalize`}>
          {entry.agentType.replace("_", " ")}
        </span>
        {entry.selected && (
          <span className="bg-indigo-600/40 text-indigo-300 px-1.5 py-0.5 rounded text-[10px]">
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
  );
}
