import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("consolidation-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[consolidation-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
