import type { AivenProjectEvent, AivenService } from "./aiven-client.js";

export interface RawMetricMessage {
  readonly serviceId: string;
  readonly serviceType: string;
  readonly metricName: string;
  readonly value: number;
  readonly previousValue?: number;
  readonly baseline?: number;
  readonly labels?: Record<string, string>;
  readonly timestamp: string;
  readonly environment: string;
}

export interface RawLogMessage {
  readonly project: string;
  readonly serviceId: string;
  readonly serviceType: string;
  readonly unit?: string;
  readonly message: string;
  readonly offset?: string;
  readonly timestamp: string;
  readonly observedAt: string;
  readonly environment: string;
}

/** Metadata snapshot for a single Aiven service (state, config, create/update times). */
interface RawServiceMetadataMessage {
  readonly project: string;
  readonly serviceId: string;
  readonly serviceType?: string;
  readonly source: "aiven.service";
  readonly snapshot: AivenService;
  readonly timestamp: string;
  readonly environment: string;
}

/** Metadata snapshot for a project-level audit event from the Aiven events API. */
interface RawProjectEventMetadataMessage {
  readonly project: string;
  readonly serviceId?: string;
  readonly serviceType?: string;
  readonly source: "aiven.project_event";
  readonly snapshot: AivenProjectEvent;
  readonly timestamp: string;
  readonly environment: string;
}

/** Metadata snapshot emitted by the collector itself (e.g. collector heartbeat or config state). */
interface RawCollectorMetadataMessage {
  readonly project: string;
  readonly serviceId?: string;
  readonly serviceType?: string;
  readonly source: "aiven.collector";
  readonly snapshot: Record<string, unknown>;
  readonly timestamp: string;
  readonly environment: string;
}

/**
 * Discriminated union of all metadata message shapes published to
 * TELEMETRY_METADATA_RAW. Use the `source` field to narrow `snapshot`.
 */
export type RawMetadataMessage =
  | RawServiceMetadataMessage
  | RawProjectEventMetadataMessage
  | RawCollectorMetadataMessage;
