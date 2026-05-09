"use client";

/**
 * Policy state panel — Roadmap Stage 4.
 *
 * Displays the current policy vector (exploration, retrieval bias, risk
 * tolerance) once packages/policy-engine writes versioned snapshots to
 * OpenSearch. Until then the API returns a static default and this panel
 * shows those placeholder values.
 *
 * Wire into WorkbenchLayout alongside MemoryContextPane once Stage 4 lands.
 */

interface PolicySnapshot {
  version: string;
  timestamp: string;
  retrievalBias: number;
  riskTolerance: number;
  explorationFactor: number;
}

interface Props {
  policy: PolicySnapshot | null;
}

const DEFAULT: PolicySnapshot = {
  version: "default",
  timestamp: new Date().toISOString(),
  retrievalBias: 0.5,
  riskTolerance: 0.5,
  explorationFactor: 0.5,
};

export function PolicyPane({ policy }: Props) {
  const p = policy ?? DEFAULT;

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
          Policy State
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5 font-mono">v{p.version}</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <PolicyGauge label="Retrieval Bias" value={p.retrievalBias} />
        <PolicyGauge label="Risk Tolerance" value={p.riskTolerance} />
        <PolicyGauge label="Exploration Factor" value={p.explorationFactor} />

        <p className="text-xs text-zinc-600 pt-2">
          Full drift timeline available from Stage 4.
        </p>
      </div>
    </div>
  );
}

function PolicyGauge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const barColor =
    pct > 70 ? "bg-green-500" : pct > 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-700">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
