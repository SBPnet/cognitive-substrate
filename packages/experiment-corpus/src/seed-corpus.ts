/**
 * Seeds the experiment corpus into OpenSearch.
 *
 * Writes:
 *   memory_semantic  — 9 SemanticMemory records (CORPUS_MEMORIES)
 *   memory_links     — 6 MemoryLink edges (CORPUS_LINKS)
 *
 * Documents are indexed by their natural IDs (memoryId / linkId).
 * Existing documents are overwritten so the script is idempotent.
 *
 * Usage:
 *   OPENSEARCH_URL=http://thor:9200 node --import tsx/esm src/seed-corpus.ts
 *   OPENSEARCH_URL=http://thor:9200 pnpm seed
 */

import {
  createOpenSearchClient,
  indexDocument,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import { CORPUS_LINKS, CORPUS_MEMORIES } from "./corpus.js";

async function main(): Promise<void> {
  const config = opensearchConfigFromEnv();
  console.log(`Seeding corpus on ${config.node} ...`);

  const client = createOpenSearchClient(config);

  // Seed memories
  console.log(`\nIndexing ${CORPUS_MEMORIES.length} memories into memory_semantic ...`);
  for (const memory of CORPUS_MEMORIES) {
    await indexDocument(client, "memory_semantic", memory.memoryId, {
      memory_id: memory.memoryId,
      created_at: memory.createdAt,
      summary: memory.summary,
      generalization: memory.generalization,
      // Embedding vectors are 4-dim stubs for the experiment corpus — omit knn_vector
      // fields (embedding, embedding_qwen, embedding_nomic, embedding_bge_m3) which
      // require the full production dimension. Experiment 1 uses scalar-field retrieval.
      source_event_ids: memory.sourceEventIds,
      importance_score: memory.importanceScore,
      stability_score: memory.stabilityScore,
      contradiction_score: memory.contradictionScore,
      semantic_cluster: memory.semanticCluster,
      usage_frequency: memory.usageFrequency,
    });
    console.log(`  indexed ${memory.memoryId} (${memory.semanticCluster})`);
  }

  // Seed links
  console.log(`\nIndexing ${CORPUS_LINKS.length} links into memory_links ...`);
  for (const link of CORPUS_LINKS) {
    await indexDocument(client, "memory_links", link.linkId, {
      link_id: link.linkId,
      source_memory_id: link.sourceMemoryId,
      target_memory_id: link.targetMemoryId,
      relationship_type: link.relationshipType,
      strength: link.strength,
      created_at: link.createdAt,
    });
    console.log(`  indexed ${link.linkId} (${link.relationshipType}: ${link.sourceMemoryId} → ${link.targetMemoryId})`);
  }

  console.log("\nCorpus seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
