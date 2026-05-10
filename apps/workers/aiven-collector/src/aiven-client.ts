import { AivenBaseClient } from "@cognitive-substrate/aiven-client";

export type { AivenService } from "@cognitive-substrate/aiven-client";

export interface AivenLogEntry {
  readonly msg?: string;
  readonly message?: string;
  readonly time?: string;
  readonly unit?: string;
  readonly [key: string]: unknown;
}

export interface AivenLogResponse {
  readonly first_log_offset?: string;
  readonly offset?: string;
  readonly logs?: readonly AivenLogEntry[];
  readonly [key: string]: unknown;
}

export interface AivenProjectEvent {
  readonly id?: string;
  readonly service_name?: string;
  readonly event_type?: string;
  readonly event_desc?: string;
  readonly time?: string;
  readonly [key: string]: unknown;
}

/**
 * Data-plane Aiven client used by the collector worker.
 * Adds project-events, logs, and metrics endpoints on top of the shared
 * AivenBaseClient (which provides listServices, getService, and request).
 */
export class AivenClient extends AivenBaseClient {
  async getProjectEvents(): Promise<readonly AivenProjectEvent[]> {
    const response = await this.request<{ events?: readonly AivenProjectEvent[] }>(
      "GET",
      `/project/${this.project}/events`,
    );
    return response.events ?? [];
  }

  async getServiceLogs(
    serviceName: string,
    limit: number,
    offset?: string,
  ): Promise<AivenLogResponse> {
    return this.request<AivenLogResponse>(
      "POST",
      `/project/${this.project}/service/${serviceName}/logs`,
      compact({
        limit,
        offset,
        sort_order: "asc",
      }),
    );
  }

  async getManagedServiceMetrics(serviceName: string): Promise<unknown> {
    return this.request(
      "POST",
      `/project/${this.project}/service/${serviceName}/metrics`,
      { period: "hour" },
    );
  }

  async getApplicationMetrics(serviceName: string): Promise<unknown> {
    return this.request(
      "GET",
      `/project/${this.project}/service/${serviceName}/application/metrics`,
    );
  }
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}
