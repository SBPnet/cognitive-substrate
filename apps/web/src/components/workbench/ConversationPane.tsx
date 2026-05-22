"use client";

import { useRef, useEffect, useState, type FormEvent } from "react";
import type { ConversationTurn } from "@/hooks/use-session";
import { Spinner } from "@/components/ui/spinner";
import { ingestDocuments } from "@/lib/api-client";

const ACCEPT =
  ".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.cs,.rb,.php,.swift,.kt,.sh,.json,.yaml,.yml,.pdf";

interface Props {
  turns: ConversationTurn[];
  isSending: boolean;
  sessionId: string | null | undefined;
  onSend: (text: string) => void;
}

export function ConversationPane({ turns, isSending, sessionId, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<{ message: string; ok: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Auto-dismiss status toast after 3 s
  useEffect(() => {
    if (!ingestStatus) return;
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setIngestStatus(null), 3000);
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [ingestStatus]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !sessionId || isSending) return;
    setDraft("");
    onSend(text);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) {
      setPendingFiles((prev) => {
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...selected.filter((f) => !existing.has(f.name))];
      });
    }
    // Reset the input so the same file can be re-selected after removal
    e.target.value = "";
  }

  function removeFile(name: string) {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleIngest() {
    if (!sessionId || pendingFiles.length === 0 || isIngesting) return;
    setIsIngesting(true);
    try {
      const result = await ingestDocuments(sessionId, pendingFiles);
      setPendingFiles([]);
      setIngestStatus({
        message: `Queued ${result.totalChunks} chunk${result.totalChunks === 1 ? "" : "s"} from ${result.documents.length} file${result.documents.length === 1 ? "" : "s"}`,
        ok: true,
      });
    } catch (err) {
      setIngestStatus({
        message: err instanceof Error ? err.message : "Ingest failed",
        ok: false,
      });
    } finally {
      setIsIngesting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-zinc-700 bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
          Conversation
        </h2>
        {sessionId && (
          <p className="text-xs text-zinc-500 font-mono mt-0.5 truncate">{sessionId}</p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {turns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500 text-sm">
              {sessionId
                ? "Send a message to begin the cognitive loop."
                : "Starting session…"}
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <MessageBubble key={turn.id} turn={turn} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* File chips row */}
      {pendingFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-700 bg-zinc-900 flex flex-wrap gap-1.5">
          {pendingFiles.map((file) => (
            <span
              key={file.name}
              className="flex items-center gap-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
            >
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="text-zinc-500">({formatBytes(file.size)})</span>
              <button
                type="button"
                onClick={() => removeFile(file.name)}
                className="ml-0.5 text-zinc-400 hover:text-zinc-100"
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="relative">
        {/* Status toast — floats above the form */}
        {ingestStatus && (
          <div
            className={`absolute bottom-full left-4 right-4 mb-1 px-3 py-2 rounded-lg text-xs font-medium ${
              ingestStatus.ok
                ? "bg-emerald-900/80 text-emerald-200 border border-emerald-700"
                : "bg-red-900/80 text-red-200 border border-red-700"
            }`}
          >
            {ingestStatus.message}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex gap-2 px-4 py-3 border-t border-zinc-700 bg-zinc-900"
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!sessionId}
            title="Attach files"
            className="flex items-center justify-center px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PaperclipIcon />
          </button>

          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={sessionId ? "Type a message…" : "Initialising…"}
            disabled={!sessionId || isSending}
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />

          {/* Ingest button — only shown when files are staged */}
          {pendingFiles.length > 0 && (
            <button
              type="button"
              onClick={() => void handleIngest()}
              disabled={!sessionId || isIngesting}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isIngesting ? <Spinner size={14} /> : null}
              Ingest
            </button>
          )}

          <button
            type="submit"
            disabled={!sessionId || isSending || !draft.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSending ? <Spinner size={14} /> : null}
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ turn }: { turn: ConversationTurn }) {
  const isUser = turn.role === "user";
  const isFailed = turn.status === "failed";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : isFailed
              ? "bg-red-900/60 text-red-200 border border-red-700 rounded-bl-sm"
              : "bg-zinc-700 text-zinc-100 rounded-bl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap">{turn.text}</p>
        <div className="flex items-center gap-2 mt-1.5 opacity-60">
          <span className="text-[10px] font-mono">
            {new Date(turn.timestamp).toLocaleTimeString()}
          </span>
          {turn.confidence !== undefined && (
            <span className="text-[10px]">
              conf {Math.round(turn.confidence * 100)}%
            </span>
          )}
          {turn.riskScore !== undefined && turn.riskScore > 0.3 && (
            <span className="text-[10px] text-amber-400">
              risk {Math.round(turn.riskScore * 100)}%
            </span>
          )}
          {turn.status === "queued" && (
            <span className="text-[10px] text-indigo-300">queued</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
