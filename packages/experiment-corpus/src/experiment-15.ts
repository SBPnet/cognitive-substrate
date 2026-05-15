/**
 * Experiment 15 — Cross-Domain Operational Correlation
 *
 * Validates that the substrate can ingest and correlate operational signals
 * from multiple sources (database metrics, Zendesk tickets, Slack threads)
 * across four incident time windows: normal → degraded → outage → recovery.
 *
 * The generator produces synthetic `OperationalSignal` records that extend
 * `ExperienceEvent`, making them directly indexable in `experience_events`.
 * Each signal carries a structured `payload` with cross-domain fields so
 * that correlation queries can join on `affectedServices` and time windows.
 *
 * This experiment is a *dataset generation* experiment: it proves that the
 * operational signal schema is self-consistent and that the four time windows
 * produce measurably distinct severity distributions. Subsequent experiments
 * can feed this dataset into the retrieval and reinforcement pipelines.
 *
 * Hypotheses:
 *   H1: The generator produces exactly 200 signals (40 normal + 60 degraded
 *       + 50 outage + 50 recovery).
 *   H2: Mean severity is ordered: normal < recovery < degraded < outage.
 *       Recovery severity falls back toward normal as the incident resolves,
 *       sitting above normal (still some correlated signals) but well below
 *       the degraded and outage peaks.
 *   H3: Outage-window signals have a higher rate of cross-domain correlation
 *       (zendesk + slack both present) than normal-window signals.
 *   H4: All signals carry non-empty graphSeeds and a valid eventId — the
 *       schema is self-consistent and ready for indexing.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp15
 */

import { generateAllOperationalData } from "./generators/operational.js";
import { saveResults } from "./results.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Experiment 15: Cross-Domain Operational Correlation ===\n");

  const signals = generateAllOperationalData();

  // Window boundaries match the generator: 40 normal, 60 degraded, 50 outage, 50 recovery
  const byWindow = {
    normal: signals.filter((s) => s.tags.includes("normal")),
    degraded: signals.filter((s) => s.tags.includes("degraded")),
    outage: signals.filter((s) => s.tags.includes("outage")),
    recovery: signals.filter((s) => s.tags.includes("recovery")),
  };

  const meanSeverity = (arr: typeof signals) =>
    arr.reduce((sum, s) => sum + s.importanceScore, 0) / arr.length;

  const crossDomainRate = (arr: typeof signals) =>
    arr.filter((s) => s.payload.zendesk !== undefined && s.payload.slack !== undefined).length /
    arr.length;

  const severities = {
    normal: meanSeverity(byWindow.normal),
    degraded: meanSeverity(byWindow.degraded),
    outage: meanSeverity(byWindow.outage),
    recovery: meanSeverity(byWindow.recovery),
  };

  const xdRates = {
    normal: crossDomainRate(byWindow.normal),
    outage: crossDomainRate(byWindow.outage),
  };

  console.log(`Generated ${signals.length} signals:`);
  for (const [window, arr] of Object.entries(byWindow)) {
    console.log(
      `  ${window.padEnd(9)}: ${String(arr.length).padStart(3)} signals  severity=${meanSeverity(arr).toFixed(3)}  xd_rate=${crossDomainRate(arr).toFixed(3)}`,
    );
  }

  const schemaViolations = signals.filter(
    (s) => !s.eventId || !s.graphSeeds || s.graphSeeds.length === 0,
  ).length;

  // H1: total count
  const h1Pass = signals.length === 200;
  console.log(`\nH1 — total signals = 200: ${signals.length}: ${h1Pass ? "✓ PASS" : "✗ FAIL"}`);

  // H2: severity ordering normal < recovery < degraded < outage
  // Recovery severity falls back toward normal as the incident resolves.
  const h2Pass =
    severities.normal < severities.recovery &&
    severities.recovery < severities.degraded &&
    severities.degraded < severities.outage;
  console.log(
    `H2 — severity ordering normal < recovery < degraded < outage: ${severities.normal.toFixed(3)} < ${severities.recovery.toFixed(3)} < ${severities.degraded.toFixed(3)} < ${severities.outage.toFixed(3)}: ${h2Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H3: outage cross-domain rate > normal
  const h3Pass = xdRates.outage > xdRates.normal;
  console.log(
    `H3 — outage xd_rate (${xdRates.outage.toFixed(3)}) > normal xd_rate (${xdRates.normal.toFixed(3)}): ${h3Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  // H4: schema self-consistent (no missing eventId or empty graphSeeds)
  const h4Pass = schemaViolations === 0;
  console.log(
    `H4 — schema violations: ${schemaViolations}: ${h4Pass ? "✓ PASS" : "✗ FAIL"}`,
  );

  saveResults("exp15", [
    `H1 total signals = 200: ${h1Pass ? "PASS" : "FAIL"} (actual=${signals.length})`,
    `H2 severity ordered normal < recovery < degraded < outage: ${h2Pass ? "PASS" : "FAIL"}`,
    `H3 outage xd_rate > normal: ${h3Pass ? "PASS" : "FAIL"} (${xdRates.outage.toFixed(3)} > ${xdRates.normal.toFixed(3)})`,
    `H4 schema self-consistent: ${h4Pass ? "PASS" : "FAIL"} (violations=${schemaViolations})`,
  ].join("; "), {
    hypotheses: { h1: h1Pass, h2: h2Pass, h3: h3Pass, h4: h4Pass },
    totalSignals: signals.length,
    windowCounts: Object.fromEntries(Object.entries(byWindow).map(([k, v]) => [k, v.length])),
    severities,
    crossDomainRates: xdRates,
    schemaViolations,
  });

  console.log("\nResults saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
