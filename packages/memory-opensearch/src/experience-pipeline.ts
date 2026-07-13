/**
 * Ensures the production experience_events embedding ingest pipeline is
 * attached. Blog telemetry ingest (packages/ingest-worker) relies on the
 * index default_pipeline; without it, docs land with empty vectors and live
 * kNN recall fails (Exp 45 H3 / Exp 52).
 *
 * Contract: all-mpnet-base-v2 → 768-d field `embedding` (matches
 * EMBEDDING_DIMENSION=768 in docker-compose.app.yml).
 */

import type { Client } from "@opensearch-project/opensearch";
import { OpenSearchMlClient } from "./ml-inference.js";

export const EXPERIENCE_EVENTS_EMBED_PIPELINE = "experience-events-embed";
export const EXPERIENCE_EVENTS_INDEX = "experience_events";

/**
 * Create/update the text_embedding pipeline and set it as the index
 * default_pipeline when OPENSEARCH_MODEL_ID is configured.
 *
 * Safe to call on every worker/orchestrator startup. No-ops when the model
 * id env var is absent (local unit tests, smoke stubs).
 */
export async function ensureExperienceEventsEmbedPipeline(
  client: Client,
  options?: {
    readonly modelId?: string;
    readonly pipelineId?: string;
    readonly index?: string;
  },
): Promise<{ attached: boolean; modelId?: string; pipelineId: string }> {
  const pipelineId = options?.pipelineId ?? EXPERIENCE_EVENTS_EMBED_PIPELINE;
  const index = options?.index ?? EXPERIENCE_EVENTS_INDEX;
  const modelId = options?.modelId ?? process.env["OPENSEARCH_MODEL_ID"];

  if (!modelId) {
    return { attached: false, pipelineId };
  }

  const ml = new OpenSearchMlClient(client);
  await ml.ensureEmbeddingIngestPipeline(pipelineId, modelId, "summary", "embedding");

  const exists = await client.indices.exists({ index });
  if (exists.body) {
    await client.indices.putSettings({
      index,
      body: { index: { default_pipeline: pipelineId } },
    });
  }

  return { attached: true, modelId, pipelineId };
}
