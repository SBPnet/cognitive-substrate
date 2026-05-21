/**
 * Cascade logic for Memory Critique Events.
 *
 * When a critique targets a memory at the `concept` or `principle` abstraction
 * level, the downgrade should propagate to all lower-level memories derived
 * from it. This file implements the cascade by searching OpenSearch for
 * memories that reference the critiqued memory in their `source_ids` field
 * and applying a reduced trust penalty at each level.
 */

import type { Client } from "@opensearch-project/opensearch";
import type { MemoryCritiqueEvent } from "@cognitive-substrate/core-types";
import { updateDocument, search } from "@cognitive-substrate/memory-opensearch";

const CASCADE_LEVELS: ReadonlyArray<string> = ["concept", "principle", "worldview"];

/** How much to reduce the penalty at each level below the critiqued one. */
const CASCADE_ATTENUATION = 0.5;

interface SemanticMemoryDoc extends Record<string, unknown> {
  readonly memory_id?: string;
  readonly retrieval_priority?: number;
  readonly abstraction_level?: string;
  readonly source_ids?: ReadonlyArray<string>;
}

/**
 * Apply trust score reduction to the critiqued memory and, when the
 * abstraction level warrants it, cascade to derived memories.
 */
export async function applyCritiqueAndCascade(
  client: Client,
  critique: MemoryCritiqueEvent,
  trustDelta: number,
): Promise<{ updated: number }> {
  let updated = 0;

  if (critique.memoryId) {
    await applyTrustDelta(client, critique.memoryId, trustDelta);
    updated++;
  }

  // Only cascade from concept level and above.
  if (!critique.memoryId || !CASCADE_LEVELS.includes(critique.abstractionLevel ?? "")) {
    return { updated };
  }

  updated += await cascadeToDescendants(client, critique.memoryId, trustDelta);
  return { updated };
}

async function applyTrustDelta(client: Client, memoryId: string, delta: number): Promise<void> {
  // Fetch current retrieval_priority to clamp the result.
  const doc = await fetchSemanticMemory(client, memoryId);
  if (!doc) return;

  const current = doc.retrieval_priority ?? 0.5;
  const next = Math.max(0, Math.min(1, current + delta));

  await updateDocument(client, "memory_semantic", memoryId, {
    retrieval_priority: next,
    last_critique_at: new Date().toISOString(),
  });
}

async function cascadeToDescendants(
  client: Client,
  parentId: string,
  delta: number,
): Promise<number> {
  // Find memories whose source_ids include the critiqued memory.
  const hits = await search<SemanticMemoryDoc>(client, "memory_semantic", {
    query: { term: { "source_ids.keyword": parentId } },
    size: 50,
  });

  let updated = 0;
  const attenuatedDelta = delta * CASCADE_ATTENUATION;

  for (const hit of hits) {
    const id = hit._id;
    if (!id) continue;

    const current = hit._source.retrieval_priority ?? 0.5;
    const next = Math.max(0, Math.min(1, current + attenuatedDelta));
    await updateDocument(client, "memory_semantic", id, {
      retrieval_priority: next,
      last_critique_at: new Date().toISOString(),
    });
    updated++;
  }

  return updated;
}

async function fetchSemanticMemory(
  client: Client,
  memoryId: string,
): Promise<SemanticMemoryDoc | undefined> {
  try {
    const result = await client.get({ index: "memory_semantic", id: memoryId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (result.body as any)._source as SemanticMemoryDoc | undefined;
  } catch {
    return undefined;
  }
}
