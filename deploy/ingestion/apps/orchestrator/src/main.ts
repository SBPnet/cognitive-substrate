import { startHealthServerFromEnv } from "@cognitive-substrate/telemetry-otel";
import { startOrchestrator } from "./worker.js";
import { runOpenEndedEvolutionMode } from "./open-ended.js";

const entrypoint = process.env["COGNITIVE_SUBSTRATE_MODE"] === "open-ended"
  ? runOpenEndedEvolutionMode
  : startOrchestrator;

startHealthServerFromEnv("orchestrator");

entrypoint().catch((err: unknown) => {
  process.stderr.write(`[orchestrator] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
