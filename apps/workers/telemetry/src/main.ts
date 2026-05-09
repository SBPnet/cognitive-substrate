import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("telemetry-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[telemetry-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
