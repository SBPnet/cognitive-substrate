/**
 * Lightweight HTTP health-check server used by every long-running worker.
 *
 * Exposes a single `/health` endpoint that returns a JSON status document.
 * The server binds to `0.0.0.0` so that container probes can reach it.
 * Behaviour is controlled by environment variables:
 *
 *   DISABLE_HEALTH_SERVER  — set to "true" to skip starting the server
 *   PORT / HEALTH_PORT     — port override (PORT is checked first)
 *
 * The endpoint contract is described by the OpenAPI 3.1 fragment exported
 * as `HEALTH_OPENAPI_FRAGMENT`. Every worker exposes the same `/health`
 * shape, so consumers (Kubernetes probes, dashboards, the workbench
 * fleet view) can rely on this single description rather than per-worker
 * documentation.
 */

import { createServer, type Server } from "node:http";

/**
 * OpenAPI 3.1 fragment describing the `/health` endpoint exposed by
 * every worker. The fragment is not a complete OpenAPI document; it
 * defines a single path and the response schema, intended to be merged
 * into the per-service OpenAPI spec or used directly by tooling that
 * accepts path objects (for example, `apps/api`'s `docs/api/openapi.yaml`
 * pulls in the same shape under its own `/health` route).
 */
export const HEALTH_OPENAPI_FRAGMENT = {
  paths: {
    "/health": {
      get: {
        summary: "Health probe",
        description:
          "Returns the worker liveness state. Used by container orchestrators and the workbench fleet view.",
        operationId: "getHealth",
        tags: ["health"],
        responses: {
          "200": {
            description: "Service is healthy.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthStatus" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthStatus: {
        type: "object",
        required: ["service", "status", "timestamp"],
        properties: {
          service: {
            type: "string",
            description: "Logical service name passed to startHealthServerFromEnv().",
            example: "ingestion-worker",
          },
          status: {
            type: "string",
            enum: ["ok"],
            description:
              "Liveness state. The endpoint only returns 200 when the process is alive; richer readiness signals are not implemented yet.",
          },
          timestamp: {
            type: "string",
            format: "date-time",
            description: "ISO-8601 timestamp captured at response time.",
          },
        },
      },
    },
  },
} as const;

/**
 * Starts the health server unless `DISABLE_HEALTH_SERVER=true`.
 * Returns the underlying Node `Server` so callers can `close()` it during
 * graceful shutdown, or `undefined` when the server is disabled.
 */
export function startHealthServerFromEnv(
  serviceName: string,
  defaultPort = 3000,
): Server | undefined {
  if (process.env["DISABLE_HEALTH_SERVER"] === "true") return undefined;

  const port = Number(process.env["PORT"] ?? process.env["HEALTH_PORT"] ?? defaultPort);
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        service: serviceName,
        status: "ok",
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`[${serviceName}] health server listening on 0.0.0.0:${port}\n`);
  });

  return server;
}
