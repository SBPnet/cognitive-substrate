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
  name?: string | undefined;
  createdAt: string;
  messageCount: number;
  status: "active" | "idle";
}

export interface KafkaEventDto {
  topic: string;
  key: string;
  timestamp: string;
  payload: unknown;
}

export interface PolicySnapshotDto {
  version: string;
  timestamp: string;
  retrievalBias: number;
  riskTolerance: number;
  explorationFactor: number;
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

export interface CollectorServiceDto {
  name: string;
  type: string;
  state: string;
  plan?: string | undefined;
  cloud?: string | undefined;
}

export interface CollectorConfigDto {
  project: string;
  collectorService: string;
  selectedServices: string[];
  services: CollectorServiceDto[];
  collectorState?: string | undefined;
  deploymentStatus?: string | undefined;
  buildStatus?: string | undefined;
}

export type SseEventType = "interaction_response" | "kafka_event" | "ping" | "connected" | "error";

export interface SseEnvelope<T = unknown> {
  type: SseEventType;
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

// ---------------------------------------------------------------------------
// Document Ingestion
// ---------------------------------------------------------------------------

export interface IngestDocumentResult {
  filename: string;
  format: string;
  chunks: number;
  eventIds: string[];
}

export interface IngestDocumentsResponse {
  documents: IngestDocumentResult[];
  totalChunks: number;
}

export async function ingestDocuments(
  sessionId: string,
  files: File[],
  options?: { importance?: number; tags?: string },
): Promise<IngestDocumentsResponse> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (options?.importance !== undefined) form.append("importance", String(options.importance));
  if (options?.tags) form.append("tags", options.tags);

  // Do not set Content-Type — browser sets it with the correct multipart boundary
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `Ingest failed: ${res.status}`);
  }
  return res.json() as Promise<IngestDocumentsResponse>;
}

// ---------------------------------------------------------------------------
// Collector Control
// ---------------------------------------------------------------------------

export async function getCollectorConfig(): Promise<CollectorConfigDto> {
  const res = await fetch(`${API_BASE}/collector`);
  if (!res.ok) throw new Error(`Failed to load collector config: ${res.status}`);
  return res.json() as Promise<CollectorConfigDto>;
}

export async function updateCollectorServices(
  services: string[],
): Promise<CollectorConfigDto> {
  const res = await fetch(`${API_BASE}/collector`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ services }),
  });
  if (!res.ok) throw new Error(`Failed to update collector services: ${res.status}`);
  return res.json() as Promise<CollectorConfigDto>;
}

// ---------------------------------------------------------------------------
// Sessions list + rename
// ---------------------------------------------------------------------------

export async function listSessions(limit = 50): Promise<{ sessions: SessionDto[]; total: number }> {
  const res = await fetch(`${API_BASE}/sessions?limit=${limit}`);
  if (!res.ok) return { sessions: [], total: 0 };
  return res.json() as Promise<{ sessions: SessionDto[]; total: number }>;
}

export async function renameSession(sessionId: string, name: string): Promise<SessionDto> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to rename session: ${res.status}`);
  return res.json() as Promise<SessionDto>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function getSessionPolicy(sessionId: string): Promise<PolicySnapshotDto> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/policy`);
  if (!res.ok) {
    return { version: "default", timestamp: new Date().toISOString(), retrievalBias: 0.5, riskTolerance: 0.5, explorationFactor: 0.5 };
  }
  return res.json() as Promise<PolicySnapshotDto>;
}
