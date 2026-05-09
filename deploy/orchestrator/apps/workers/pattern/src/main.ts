import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("pattern-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[pattern-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
