import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("memory-critique-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[memory-critique-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
