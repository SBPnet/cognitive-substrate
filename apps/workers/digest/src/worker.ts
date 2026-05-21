/**
 * Weekly Memory Digest worker.
 *
 * Runs on a Sunday weekly cron (or immediately when RUN_NOW=1 is set).
 * Queries OpenSearch for the past 7 days of blog/reader telemetry events,
 * aggregates tag frequencies, abstraction patterns, trust score changes,
 * and reader behavior anomalies, then writes a structured Markdown report.
 *
 * Env vars:
 *   OPENSEARCH_URL        — OpenSearch endpoint
 *   DIGEST_OUTPUT_PATH    — file path for the Markdown report (default: ./digest.md)
 *   SLACK_WEBHOOK_URL     — optional Slack webhook to post the report
 *   RUN_NOW               — set to "1" to run immediately and exit (useful for testing)
 */

import { writeFile } from "node:fs/promises";
import { createOpenSearchClient, opensearchConfigFromEnv } from "@cognitive-substrate/memory-opensearch";
import {
  fetchWeeklyEvents,
  fetchRecentAbstractionPatterns,
  fetchTrustDeltaMemories,
  fetchBehaviorAnomalies,
  fetchKnowledgeGapTopics,
} from "./queries.js";
import { formatDigest } from "./formatter.js";

const DIGEST_OUTPUT_PATH = process.env["DIGEST_OUTPUT_PATH"] ?? "./digest.md";
const SLACK_WEBHOOK_URL = process.env["SLACK_WEBHOOK_URL"];

export async function runDigest(): Promise<void> {
  const log = (msg: string): void => {
    process.stdout.write(`[digest-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  log("Starting weekly digest run...");
  const client = createOpenSearchClient(opensearchConfigFromEnv());

  const [weeklyEvents, patterns, trustDeltas, anomalies, gaps] = await Promise.all([
    fetchWeeklyEvents(client),
    fetchRecentAbstractionPatterns(client),
    fetchTrustDeltaMemories(client),
    fetchBehaviorAnomalies(client),
    fetchKnowledgeGapTopics(client),
  ]);

  const now = new Date();
  const weekOf = now.toISOString().split("T")[0] ?? now.toLocaleDateString();

  const digest = formatDigest({
    weekOf,
    totalEvents: weeklyEvents.totalCount,
    topTags: weeklyEvents.tags,
    abstractionPatterns: patterns,
    trustDeltas: trustDeltas,
    anomalies,
    knowledgeGaps: gaps,
  });

  // Write to file.
  await writeFile(DIGEST_OUTPUT_PATH, digest, "utf-8");
  log(`Digest written to ${DIGEST_OUTPUT_PATH} (${digest.length} chars)`);

  // Optionally post to Slack.
  if (SLACK_WEBHOOK_URL) {
    await postToSlack(SLACK_WEBHOOK_URL, digest, log);
  }

  log("Digest run complete.");
}

async function postToSlack(
  webhookUrl: string,
  digest: string,
  log: (msg: string) => void,
): Promise<void> {
  // Truncate to Slack's block text limit (3000 chars per block).
  const preview = digest.slice(0, 2800) + (digest.length > 2800 ? "\n…_(truncated)_" : "");
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: preview }),
    });
    if (!res.ok) {
      log(`Slack post failed: ${res.status}`);
    } else {
      log("Digest posted to Slack.");
    }
  } catch (err) {
    log(`Slack post error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Returns milliseconds until next Sunday 06:00 UTC. */
function msUntilNextSunday(): number {
  const now = new Date();
  const sunday = new Date(now);
  // 0 = Sunday
  sunday.setUTCHours(6, 0, 0, 0);
  const daysUntilSunday = (7 - now.getUTCDay()) % 7;
  sunday.setUTCDate(sunday.getUTCDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday));
  return sunday.getTime() - now.getTime();
}

export async function startScheduledDigest(): Promise<void> {
  const log = (msg: string): void => {
    process.stdout.write(`[digest-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const scheduleNext = (): void => {
    const delayMs = msUntilNextSunday();
    const delayHours = (delayMs / 3_600_000).toFixed(1);
    log(`Next digest scheduled in ${delayHours}h`);
    setTimeout(() => {
      void runDigest().finally(scheduleNext);
    }, delayMs);
  };

  scheduleNext();
  log("Digest scheduler running. Waiting for next Sunday 06:00 UTC...");
  // Keep process alive.
  await new Promise<void>(() => undefined);
}
