import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("aiven-collector-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[aiven-collector-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
