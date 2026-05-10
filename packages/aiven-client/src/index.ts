/**
 * Shared Aiven API types and base HTTP client.
 *
 * Both the aiven-collector worker (data-plane reads) and the api collector
 * route (control-plane reads/updates) extend AivenBaseClient rather than
 * duplicating the auth/fetch/error pattern.
 */

/**
 * Canonical Aiven service shape.  Fields are the superset observed across
 * the data-plane (metadata collection) and control-plane (application config)
 * use cases.  The index signature allows downstream code to access additional
 * vendor-specific fields without type errors.
 */
export interface AivenService {
  readonly service_name: string;
  readonly service_type?: string;
  readonly state?: string;
  readonly plan?: string;
  readonly cloud_name?: string;
  readonly create_time?: string;
  readonly update_time?: string;
  readonly metadata?: Record<string, unknown>;
  readonly user_config?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * Base class for Aiven API clients.  Provides authenticated fetch, shared
 * service listing, and a protected `request<T>()` helper so subclasses do
 * not duplicate HTTP error handling or auth header logic.
 */
export class AivenBaseClient {
  constructor(
    protected readonly apiBaseUrl: string,
    protected readonly token: string,
    public readonly project: string,
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

  protected async request<T>(
    method: string,
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
