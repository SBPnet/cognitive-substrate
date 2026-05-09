"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCollectorConfig,
  updateCollectorServices,
  type CollectorConfigDto,
} from "@/lib/api-client";

export function CollectorControlPane() {
  const [config, setConfig] = useState<CollectorConfigDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("Loading collector configuration...");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getCollectorConfig();
      setConfig(next);
      setSelected(new Set(next.selectedServices));
      setStatus("Collector configuration loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load collector configuration.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCount = selected.size;
  const serviceCount = config?.services.length ?? 0;
  const allSelected = serviceCount > 0 && selectedCount === serviceCount;

  const servicesByType = useMemo(() => {
    const groups = new Map<string, NonNullable<CollectorConfigDto["services"]>>();
    for (const service of config?.services ?? []) {
      const group = groups.get(service.type) ?? [];
      group.push(service);
      groups.set(service.type, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [config]);

  const toggleService = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      if (!config) return current;
      if (current.size === config.services.length) return new Set();
      return new Set(config.services.map((service) => service.name));
    });
  }, [config]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setStatus("Updating collector service list...");
    try {
      const next = await updateCollectorServices([...selected].sort());
      setConfig(next);
      setSelected(new Set(next.selectedServices));
      setStatus("Collector service list updated. Aiven may restart the collector to apply it.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update collector configuration.");
    } finally {
      setIsSaving(false);
    }
  }, [selected]);

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
            Aiven Collector
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {selectedCount} of {serviceCount} services selected
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void load()}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => void save()}
            disabled={!config || isSaving}
            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs transition-colors"
          >
            {isSaving ? "Saving..." : "Apply"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        {config ? (
          <>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div>
                <p className="text-zinc-300 font-medium">{config.collectorService}</p>
                <p className="text-zinc-500">
                  {config.collectorState ?? "unknown"} · deploy {config.deploymentStatus ?? "unknown"}
                </p>
              </div>
              <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="accent-indigo-500"
                />
                All
              </label>
            </div>

            {servicesByType.map(([type, services]) => (
              <section key={type} className="space-y-1.5">
                <h3 className="text-[10px] uppercase tracking-widest text-zinc-500">{type}</h3>
                {services.map((service) => (
                  <label
                    key={service.name}
                    className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-zinc-800/60 cursor-pointer"
                  >
                    <span className="min-w-0">
                      <span className="block text-zinc-300 truncate">{service.name}</span>
                      <span className="block text-zinc-600 truncate">
                        {service.state}
                        {service.plan ? ` · ${service.plan}` : ""}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.has(service.name)}
                      onChange={() => toggleService(service.name)}
                      className="accent-indigo-500"
                    />
                  </label>
                ))}
              </section>
            ))}
          </>
        ) : (
          <p className="text-zinc-500">{status}</p>
        )}
      </div>

      {config ? (
        <footer className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          {status}
        </footer>
      ) : null}
    </div>
  );
}
