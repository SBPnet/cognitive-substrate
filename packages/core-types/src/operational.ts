/**
 * Operational signal types for cross-domain correlation (Exp 12+).
 * Designed with future plugin architecture in mind — sources can be
 * extended via dynamic registration.
 */

export type OperationalSource = 
  | "database_metrics"
  | "database_logs"
  | "zendesk_ticket"
  | "slack_thread";

/** Normalized database signal */
export interface DatabaseSignal {
  service: string;           // e.g. "postgres-prod"
  metric: "latency_p95" | "qps" | "error_rate" | "conn_pool_usage" | "cpu" | "disk_io";
  value: number;
  unit: string;
  threshold?: number;
  tags: string[];            // e.g. ["slow-query", "connection-exhaust"]
}

/** Zendesk ticket snapshot */
export interface ZendeskSignal {
  ticketId: string;
  title: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  tags: string[];
  resolutionTimeMs?: number;
  linkedIssues?: string[];
}

/** Slack thread summary */
export interface SlackSignal {
  channel: string;
  threadTs: string;
  participantCount: number;
  reactionScore: number;     // sum of emoji reactions
  keywords: string[];
  sentiment?: number;        // -1..1
}

/** Unified operational payload */
export interface OperationalPayload {
  source: OperationalSource;
  db?: DatabaseSignal;
  zendesk?: ZendeskSignal;
  slack?: SlackSignal;
  severity: number;          // 0–1 normalized urgency
  affectedServices: string[];
  temporalWindowMinutes?: number;
}

/** Full unified operational signal (extends ExperienceEvent) */
export interface OperationalSignal extends ExperienceEvent {
  readonly payload: OperationalPayload;
  /** Semantic embedding of the combined narrative */
  readonly correlationEmbedding?: ReadonlyArray<number>;
  /** Initial graph seeds (service names, ticket IDs, thread TS) */
  readonly graphSeeds: string[];
}

export type AnyOperationalSignal = OperationalSignal;
