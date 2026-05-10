import { Hono } from "hono";
import { AivenBaseClient, type AivenService } from "@cognitive-substrate/aiven-client";

interface AivenEnvironmentVariable {
  readonly key: string;
  readonly value?: string;
  readonly kind?: "variable" | "secret";
}

interface AivenApplicationConfig {
  environment_variables?: AivenEnvironmentVariable[];
  ports?: unknown[];
  source?: unknown;
  [key: string]: unknown;
}

interface CollectorServiceDto {
  readonly name: string;
  readonly type: string;
  readonly state: string;
  readonly plan?: string;
  readonly cloud?: string;
}

interface CollectorConfigDto {
  readonly project: string;
  readonly collectorService: string;
  readonly selectedServices: string[];
  readonly services: CollectorServiceDto[];
  readonly collectorState?: string;
  readonly deploymentStatus?: string;
  readonly buildStatus?: string;
}

interface CollectorUpdateBody {
  readonly services?: unknown;
}

export function createCollectorRouter(): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const client = clientFromEnv();
    if (!client) return c.json({ error: "Aiven collector control is not configured" }, 503);

    const config = await readCollectorConfig(client);
    return c.json(config);
  });

  router.post("/", async (c) => {
    const client = clientFromEnv();
    if (!client) return c.json({ error: "Aiven collector control is not configured" }, 503);

    const body = await c.req.json<CollectorUpdateBody>().catch((): CollectorUpdateBody => ({}));
    const requested = parseRequestedServices(body.services);
    if (!requested.ok) return c.json({ error: requested.error }, 400);

    const services = await client.listServices();
    const knownServiceNames = new Set(services.map((service) => service.service_name));
    const unknown = requested.services.filter((service) => !knownServiceNames.has(service));
    if (unknown.length > 0) {
      return c.json({ error: `Unknown Aiven services: ${unknown.join(", ")}` }, 400);
    }

    await updateCollectorServices(client, requested.services);
    const config = await readCollectorConfig(client);
    return c.json(config);
  });

  return router;
}

/**
 * Control-plane Aiven client.  Extends AivenBaseClient (listServices, getService,
 * protected request) with application-config update support needed by the
 * collector control route.  Uses GET + PUT; the data-plane AivenClient in the
 * collector worker uses GET + POST for different endpoints.
 */
class AivenControlClient extends AivenBaseClient {
  constructor(
    project: string,
    readonly collectorService: string,
    token: string,
    apiBaseUrl: string,
  ) {
    super(apiBaseUrl, token, project);
  }

  async updateCollectorApplication(application: AivenApplicationConfig): Promise<void> {
    await this.request("PUT", `/project/${this.project}/service/${this.collectorService}`, {
      user_config: { application },
    });
  }
}

function clientFromEnv(): AivenControlClient | undefined {
  const token = process.env["AIVEN_TOKEN"];
  const project = process.env["AIVEN_PROJECT"] ?? "dev-sandbox";
  const collectorService =
    process.env["AIVEN_COLLECTOR_SERVICE"] ?? "cs-aiven-collector-20260509";
  const apiBaseUrl = process.env["AIVEN_API_BASE_URL"] ?? "https://api.aiven.io/v1";

  if (!token) return undefined;
  return new AivenControlClient(project, collectorService, token, apiBaseUrl);
}

async function readCollectorConfig(client: AivenControlClient): Promise<CollectorConfigDto> {
  const [services, collector] = await Promise.all([
    client.listServices(),
    client.getService(client.collectorService),
  ]);

  const application = collector.user_config?.["application"] as AivenApplicationConfig | undefined;
  const selectedServices = csv(envValue(application, "AIVEN_SERVICES"));
  const deploymentStatus = stringMetadata(collector, "application_deployment_status");
  const buildStatus = stringMetadata(collector, "application_build_status");

  const config: CollectorConfigDto = {
    project: client.project,
    collectorService: client.collectorService,
    selectedServices,
    services: services
      .map((service) => ({
        name: service.service_name,
        type: service.service_type ?? "unknown",
        state: service.state ?? "unknown",
        ...(service.plan ? { plan: service.plan } : {}),
        ...(service.cloud_name ? { cloud: service.cloud_name } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  return {
    ...config,
    ...(collector.state ? { collectorState: collector.state } : {}),
    ...(deploymentStatus ? { deploymentStatus } : {}),
    ...(buildStatus ? { buildStatus } : {}),
  };
}

async function updateCollectorServices(
  client: AivenControlClient,
  services: readonly string[],
): Promise<void> {
  const collector = await client.getService(client.collectorService);
  const application = collector.user_config?.["application"] as AivenApplicationConfig | undefined;
  if (!application) throw new Error("Collector application configuration was not returned");

  const existing = application.environment_variables ?? [];
  const environment_variables = [
    ...existing.filter((entry) => entry.key !== "AIVEN_SERVICES"),
    { key: "AIVEN_SERVICES", value: services.join(","), kind: "variable" as const },
  ];

  await client.updateCollectorApplication({ ...application, environment_variables });
}

function parseRequestedServices(value: unknown):
  | { readonly ok: true; readonly services: string[] }
  | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "services must be an array of service names" };
  }

  const services = [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))];
  if (services.some((service) => !/^[a-zA-Z0-9_-]+$/.test(service))) {
    return { ok: false, error: "services contains an invalid service name" };
  }
  return { ok: true, services };
}

function envValue(application: AivenApplicationConfig | undefined, key: string): string | undefined {
  return application?.environment_variables?.find((entry) => entry.key === key)?.value;
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function stringMetadata(service: AivenService, key: string): string | undefined {
  const value = service.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}
