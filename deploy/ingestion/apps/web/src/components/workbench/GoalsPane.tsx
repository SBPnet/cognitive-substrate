"use client";

/**
 * Goal hierarchy panel — Roadmap Stages 11-12.
 *
 * Renders the active goal tree from the `goal_system` OpenSearch index.
 * Each goal node shows horizon, priority, progress, and status once
 * packages/agents GoalSystem persists goals and the goal_system index
 * is populated.
 *
 * Wire into WorkbenchLayout once Stage 12 ships.
 */

export interface GoalDto {
  goalId: string;
  description: string;
  horizon: "micro" | "short" | "mid" | "long" | "meta";
  priority: number;
  progress: number;
  status: "active" | "completed" | "stalled" | "cancelled" | "deferred";
  subgoals: string[];
}

interface Props {
  goals: GoalDto[];
}

const HORIZON_LABEL: Record<string, string> = {
  micro: "micro",
  short: "short",
  mid: "mid-term",
  long: "long-term",
  meta: "meta",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-green-400",
  completed: "text-zinc-500",
  stalled: "text-amber-400",
  cancelled: "text-red-400",
  deferred: "text-zinc-500",
};

export function GoalsPane({ goals }: Props) {
  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
          Goal Hierarchy
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {goals.filter((g) => g.status === "active").length} active
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {goals.length === 0 ? (
          <div className="px-1 pt-2">
            <p className="text-zinc-500 text-xs">
              Goal hierarchy available from Stage 12.
            </p>
            <p className="text-zinc-600 text-xs mt-1">
              Long-horizon objectives and goal progress will appear here once
              the goal system persists to OpenSearch.
            </p>
          </div>
        ) : (
          goals.map((g) => <GoalCard key={g.goalId} goal={g} />)
        )}
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: GoalDto }) {
  const progressPct = Math.round(goal.progress * 100);
  const statusColor = STATUS_COLOR[goal.status] ?? "text-zinc-400";

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-zinc-200 leading-relaxed">{goal.description}</p>
        <span className={`shrink-0 ${statusColor} capitalize`}>{goal.status}</span>
      </div>
      <div className="flex items-center gap-3 text-zinc-500">
        <span>{HORIZON_LABEL[goal.horizon] ?? goal.horizon}</span>
        <span>p{Math.round(goal.priority * 10)}</span>
        <span className="ml-auto font-mono">{progressPct}%</span>
      </div>
      <div className="h-1 mt-2 rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
