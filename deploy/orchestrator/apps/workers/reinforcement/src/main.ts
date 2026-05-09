import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("reinforcement-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[reinforcement-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
