"use client";

import type { PolicySnapshotDto } from "@/lib/api-client";

interface Props {
  policy: PolicySnapshotDto | null;
  onRefresh?: () => void;
}

const DEFAULT: PolicySnapshotDto = {
  version: "default",
  timestamp: new Date().toISOString(),
  retrievalBias: 0.5,
  riskTolerance: 0.5,
  explorationFactor: 0.5,
};

export function PolicyPane({ policy, onRefresh }: Props) {
  const p = policy ?? DEFAULT;

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2.5 border-b border-zinc-700/50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-0.5 h-4 rounded-full bg-amber-500" />
          <div>
            <h2 className="text-xs font-semibold text-zinc-200">Policy State</h2>
            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">v{p.version}</p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
            title="Refresh policy"
          >
            <RefreshIcon />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <PolicyGauge label="Retrieval Bias" value={p.retrievalBias} color="indigo" />
        <PolicyGauge label="Risk Tolerance" value={p.riskTolerance} color="amber" />
        <PolicyGauge label="Exploration Factor" value={p.explorationFactor} color="teal" />
      </div>
    </div>
  );
}

function PolicyGauge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "indigo" | "amber" | "teal";
}) {
  const pct = Math.round(value * 100);

  const barColors = {
    indigo: "bg-indigo-500",
    amber: "bg-amber-500",
    teal: "bg-teal-500",
  };

  const glowColors = {
    indigo: "shadow-indigo-500/20",
    amber: "shadow-amber-500/20",
    teal: "shadow-teal-500/20",
  };

  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2.5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-zinc-300">{label}</span>
        <span className="text-xs font-mono text-zinc-400">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-zinc-700">
        <div
          className={`h-full rounded-full ${barColors[color]} shadow-sm ${glowColors[color]} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
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
