/**
 * Experiment results persistence.
 *
 * Each experiment writes two files to packages/experiment-corpus/results/:
 *   <name>-<ISO-timestamp>.json   — permanent timestamped archive
 *   <name>-latest.json            — overwritten on every run (easy diffing)
 *
 * The JSON envelope carries run metadata alongside the experiment-specific
 * payload so results files are self-describing when read in isolation.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../results");

export interface ResultsEnvelope<T> {
  readonly experiment: string;
  readonly runAt: string;
  readonly opensearchUrl: string;
  readonly observations: string;
  readonly data: T;
}

/** Strip userinfo from OpenSearch URLs so credentials never land in results files. */
function redactOpenSearchUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "") || url;
  } catch {
    return url.replace(/\/\/([^/@]+)@/, "//***@");
  }
}

export function saveResults<T>(
  experimentName: string,
  observations: string,
  data: T,
): void {
  const runAt = new Date().toISOString();
  const rawUrl = process.env["OPENSEARCH_URL"] ?? "(unknown)";
  const envelope: ResultsEnvelope<T> = {
    experiment: experimentName,
    runAt,
    opensearchUrl: rawUrl === "(unknown)" ? rawUrl : redactOpenSearchUrl(rawUrl),
    observations,
    data,
  };

  const json = JSON.stringify(envelope, null, 2);
  const timestamp = runAt.replace(/[:.]/g, "-");
  const timestampedPath = join(RESULTS_DIR, `${experimentName}-${timestamp}.json`);
  const latestPath = join(RESULTS_DIR, `${experimentName}-latest.json`);

  writeFileSync(timestampedPath, json, "utf8");
  writeFileSync(latestPath, json, "utf8");

  console.log(`\nResults saved:`);
  console.log(`  ${timestampedPath}`);
  console.log(`  ${latestPath}`);
}
