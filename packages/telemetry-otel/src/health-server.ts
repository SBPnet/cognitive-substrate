import { createServer, type Server } from "node:http";

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
