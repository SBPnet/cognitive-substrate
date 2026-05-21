import { runDigest, startScheduledDigest } from "./worker.js";

// RUN_NOW=1 runs once immediately and exits — useful for testing and CI.
if (process.env["RUN_NOW"] === "1") {
  runDigest()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`[digest-worker] Fatal error: ${String(err)}\n`);
      process.exit(1);
    });
} else {
  startScheduledDigest().catch((err: unknown) => {
    process.stderr.write(`[digest-worker] Fatal error: ${String(err)}\n`);
    process.exit(1);
  });
}
