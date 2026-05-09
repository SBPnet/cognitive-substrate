export interface AivenService {
  readonly service_name: string;
  readonly service_type?: string;
  readonly state?: string;
  readonly create_time?: string;
  readonly update_time?: string;
  readonly [key: string]: unknown;
}

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

export class AivenClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
    private readonly project: string,
  ) {}

  async listServices(): Promise<readonly AivenService[]> {
    const response = await this.request<{ services?: readonly AivenService[] }>(
      "GET",
      `/project/${this.project}/service`,
    );
    return response.services ?? [];
  }

  async getService(serviceName: string): Promise<AivenService> {
    const response = await this.request<{ service?: AivenService }>(
      "GET",
      `/project/${this.project}/service/${serviceName}`,
    );
    if (!response.service) throw new Error(`Aiven service ${serviceName} was not returned`);
    return response.service;
  }

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

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Aiven API ${method} ${path} failed with ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}
