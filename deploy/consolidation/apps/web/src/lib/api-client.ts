/**
 * Typed fetch wrapper for the apps/api BFF.
 * All routes are proxied through Next.js rewrites so the base URL is /api.
 */

const API_BASE = "/api";

// ---------------------------------------------------------------------------
// Types (mirrors apps/api/src/types.ts — kept in sync manually)
// ---------------------------------------------------------------------------

export interface SessionDto {
  sessionId: string;
  userId?: string | undefined;
  createdAt: string;
  messageCount: number;
  status: "active" | "idle";
}

export interface SendMessageResponse {
  eventId: string;
  sessionId: string;
  timestamp: string;
  status: "queued";
}

export interface MemoryDto {
  memoryId: string;
  index: string;
  summary: string;
  importanceScore: number;
  score: number;
  tags?: string[] | undefined;
  lastRetrieved?: string | undefined;
}

export interface MemoriesResponse {
  memories: MemoryDto[];
  total: number;
}

export interface TraceEventDto {
  eventId: string;
  sessionId: string;
  timestamp: string;
  stage: string;
  detail?: string | undefined;
}

export interface InteractionResponseDto {
  eventId: string;
  sessionId: string;
  traceId: string;
  timestamp: string;
  status: "processing" | "complete" | "partial" | "failed";
  responseText: string;
  confidence: number;
  riskScore: number;
  errorMessage?: string | undefined;
}

export interface AgentActivityDto {
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

export interface SseEnvelope<T = unknown> {
  type: string;
  payload: T;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function createSession(userId?: string): Promise<SessionDto> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userId !== undefined ? { userId } : {}),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json() as Promise<SessionDto>;
}

export async function getSession(sessionId: string): Promise<SessionDto> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Session not found: ${sessionId}`);
  return res.json() as Promise<SessionDto>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function sendMessage(
  sessionId: string,
  text: string,
  tags?: string[],
): Promise<SendMessageResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(tags ? { tags } : {}) }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
  return res.json() as Promise<SendMessageResponse>;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

export async function getSessionMemories(
  sessionId: string,
  limit = 20,
): Promise<MemoriesResponse> {
  const res = await fetch(
    `${API_BASE}/sessions/${sessionId}/memories?limit=${limit}`,
  );
  if (!res.ok) return { memories: [], total: 0 };
  return res.json() as Promise<MemoriesResponse>;
}

export async function searchMemories(
  sessionId: string,
  query: string,
  limit = 10,
): Promise<MemoriesResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(
    `${API_BASE}/sessions/${sessionId}/memories/search?${params.toString()}`,
  );
  if (!res.ok) return { memories: [], total: 0 };
  return res.json() as Promise<MemoriesResponse>;
}

export async function getSessionTrace(
  sessionId: string,
  limit = 50,
): Promise<{ events: TraceEventDto[]; total: number }> {
  const res = await fetch(
    `${API_BASE}/sessions/${sessionId}/memories/trace?limit=${limit}`,
  );
  if (!res.ok) return { events: [], total: 0 };
  return res.json() as Promise<{ events: TraceEventDto[]; total: number }>;
}

export async function getAgentActivity(
  sessionId: string,
  limit = 30,
): Promise<{ activities: AgentActivityDto[]; total: number }> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/agents?limit=${limit}`);
  if (!res.ok) return { activities: [], total: 0 };
  return res.json() as Promise<{ activities: AgentActivityDto[]; total: number }>;
}
