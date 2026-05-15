/**
 * Provisions all 13 cognitive memory indexes on the target OpenSearch cluster.
 *
 * Safe to run multiple times — existing indexes are left untouched.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 node --import tsx/esm src/provision-indexes.ts
 *   OPENSEARCH_URL=http://thor:9200 pnpm provision
 */

import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { INDEX_SCHEMAS } from "@cognitive-substrate/memory-opensearch";

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`Provisioning indexes on ${config.node} ...`);

  const client = createOpenSearchClient(config);

  await ensureIndexes(client);

  const names = Object.keys(INDEX_SCHEMAS);
  console.log(`Done. ${names.length} indexes ensured:`);
  for (const name of names) {
    console.log(`  ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
