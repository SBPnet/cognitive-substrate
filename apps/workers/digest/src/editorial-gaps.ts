#!/usr/bin/env node
/**
 * Print digest knowledge-gap tags from live experience_events.
 * Use these as editorial candidates (topics readers touch with low importance).
 *
 *   OPENSEARCH_URL=http://thor.local:9200 pnpm --filter @cognitive-substrate/digest-worker editorial-gaps
 */

import { Client } from "@opensearch-project/opensearch";
import { fetchKnowledgeGapTopics } from "./queries.js";

async function main(): Promise<void> {
  const url = process.env["OPENSEARCH_URL"] ?? "http://localhost:9200";
  const client = new Client({ node: url });
  const gaps = await fetchKnowledgeGapTopics(client);

  console.log("── Editorial knowledge gaps (low importance, ≥5 docs) ──");
  console.log(`OpenSearch: ${url}`);
  if (gaps.length === 0) {
    console.log("(none — accumulate more blog telemetry, then re-run)");
    return;
  }
  for (const [i, tag] of gaps.entries()) {
    console.log(`${i + 1}. ${tag}`);
  }
  console.log("");
  console.log("Write or expand posts that close these curiosity spikes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
