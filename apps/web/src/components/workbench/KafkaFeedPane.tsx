"use client";

import { useRef, useEffect, useState } from "react";
import type { KafkaEventDto } from "@/lib/api-client";

interface Props {
  events: KafkaEventDto[];
}

const TOPIC_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  "experience.raw":              { label: "exp.raw",     bg: "bg-blue-500/15",   text: "text-blue-400" },
  "experience.enriched":        { label: "exp.enriched", bg: "bg-blue-500/15",   text: "text-blue-300" },
  "memory.indexed":              { label: "mem.indexed",  bg: "bg-teal-500/15",   text: "text-teal-400" },
  "memory.semantic.updated":     { label: "mem.semantic", bg: "bg-teal-500/15",   text: "text-teal-300" },
  "agent.reasoning.request":     { label: "agent.req",   bg: "bg-indigo-500/15", text: "text-indigo-400" },
  "agent.reasoning.response":    { label: "agent.resp",  bg: "bg-indigo-500/15", text: "text-indigo-300" },
  "policy.updated":              { label: "policy",      bg: "bg-amber-500/15",  text: "text-amber-400" },
  "goal.progress":               { label: "goal",        bg: "bg-green-500/15",  text: "text-green-400" },
  "interaction.response":        { label: "response",    bg: "bg-purple-500/15", text: "text-purple-400" },
};

function topicStyle(topic: string) {
  return TOPIC_STYLES[topic] ?? { label: topic.split(".").slice(-1)[0] ?? topic, bg: "bg-zinc-700/30", text: "text-zinc-400" };
}

function relativeTime(iso: string): string {
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function extractPreview(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.eventId === "string") parts.push(`id:${p.eventId.slice(0, 8)}`);
  if (typeof p.stage === "string") parts.push(`stage:${p.stage}`);
  if (typeof p.confidence === "number") parts.push(`conf:${Math.round(p.confidence * 100)}%`);
  if (typeof p.importanceScore === "number") parts.push(`imp:${Math.round(p.importanceScore * 100)}%`);
  if (typeof p.agentType === "string") parts.push(`agent:${p.agentType}`);
  if (typeof p.status === "string") parts.push(`status:${p.status}`);
  return parts.slice(0, 3).join("  ");
}

export function KafkaFeedPane({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-2 border-b border-zinc-700/50 bg-zinc-900/60 backdrop-blur-sm flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-0.5 h-4 rounded-full bg-purple-500" />
          <h2 className="text-xs font-semibold text-zinc-200">Event Stream</h2>
          <span className="text-[10px] text-zinc-500 font-mono">{events.length} events</span>
        </div>
        {events.length === 0 && (
          <span className="text-[10px] text-zinc-600">waiting for messages…</span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-xs font-mono">No Kafka events yet since you connected.</p>
          </div>
        ) : (
          <>
            {events.map((ev, i) => {
              const style = topicStyle(ev.topic);
              const preview = extractPreview(ev.payload);
              const isExpanded = expandedIdx === i;

              return (
                <div
                  key={i}
                  className="group flex items-start gap-2 px-1.5 py-1 hover:bg-zinc-800/40 rounded cursor-pointer transition-colors"
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                >
                  <span className={`flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${style.bg} ${style.text} mt-0.5`}>
                    {style.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    {isExpanded ? (
                      <pre className="text-[10px] text-zinc-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                        {JSON.stringify(ev.payload, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-[10px] text-zinc-400 font-mono truncate block">
                        {preview || JSON.stringify(ev.payload).slice(0, 80)}
                      </span>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px] text-zinc-600 font-mono mt-0.5">
                    {relativeTime(ev.timestamp)}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
