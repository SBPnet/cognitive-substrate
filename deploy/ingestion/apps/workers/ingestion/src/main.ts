/**
 * Entry point for the ingestion worker process.
 */

import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startWorker } from "./worker.js";

startHealthServerFromEnv("ingestion-worker");

startWorker().catch((err: unknown) => {
  process.stderr.write(`[ingestion-worker] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
