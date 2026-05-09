import type { Client } from "@opensearch-project/opensearch";

/**
 * OpenSearch ML Commons integration for on-cluster model inference.
 *
 * Two inference tiers are supported:
 *
 *   Tier 1 — Embedding (fast associative recall)
 *     Models: bge-small-en-v1.5, e5-small-v2, all-MiniLM-L6-v2
 *     Latency target: <30 ms
 *     Deployed to: ml-embedding node pool (CPU-optimised)
 *
 *   Tier 2 — Reranking (episodic salience scoring)
 *     Models: bge-reranker-base, cross-encoder/ms-marco-MiniLM-L-6-v2
 *     Latency target: 50–150 ms
 *     Deployed to: ml-reranker node pool (larger nodes, GPU optional)
 *
 * Ingest pipeline:
 *   When a Tier 1 embedding model is registered, a text_embedding ingest
 *   pipeline is created and attached to the experience_events index so that
 *   embeddings are generated automatically at index time without requiring
 *   the ingestion worker to call an external API.
 */

export interface MlModelConfig {
  /** Human-readable name used when registering the model. */
  name: string;
  /** HuggingFace model ID or URL to the model zip. */
  modelId: string;
  /** ML Commons model format. */
  modelFormat: "TORCH_SCRIPT" | "ONNX";
  /** ML Commons model type. */
  modelType: "text_embedding" | "text_similarity";
  /** Node pool role that should host this model. */
  nodeRole: "ml-embedding" | "ml-reranker";
  /** Output dimension (required for embedding models). */
  embeddingDimension?: number;
}

export interface RegisteredModel {
  modelId: string;
  name: string;
  status: string;
}

export interface RerankResult {
  documentIndex: number;
  score: number;
}

/**
 * Thin wrapper around the OpenSearch ML Commons REST API.
 * Exposes model lifecycle management (register, deploy, undeploy) and
 * inference helpers used by the retrieval-engine reranking pipeline.
 */
export class OpenSearchMlClient {
  constructor(private readonly client: Client) {}

  // ----------------------------------------------------------------
  // Model lifecycle
  // ----------------------------------------------------------------

  /**
   * Register a pre-trained model from a HuggingFace model group.
   * Returns the task_id; poll `getTaskStatus` until state = COMPLETED.
   */
  async registerModel(config: MlModelConfig): Promise<string> {
    const body: Record<string, unknown> = {
      name: config.name,
      version: "1.0.0",
      model_format: config.modelFormat,
      model_config: {
        model_type: config.modelType,
        ...(config.embeddingDimension !== undefined
          ? { embedding_dimension: config.embeddingDimension }
          : {}),
        framework_type: "SENTENCE_TRANSFORMERS",
      },
    };

    const response = await this.client.transport.request({
      method: "POST",
      path: "/_plugins/_ml/models/_register",
      body,
    });

    const taskId = (response.body as Record<string, unknown>)["task_id"];
    if (typeof taskId !== "string") {
      throw new Error("OpenSearch ML register response did not include task_id");
    }
    return taskId;
  }

  /** Deploy a registered model to the ML node pool so it can serve requests. */
  async deployModel(registeredModelId: string): Promise<string> {
    const response = await this.client.transport.request({
      method: "POST",
      path: `/_plugins/_ml/models/${registeredModelId}/_deploy`,
    });
    const taskId = (response.body as Record<string, unknown>)["task_id"];
    if (typeof taskId !== "string") {
      throw new Error("OpenSearch ML deploy response did not include task_id");
    }
    return taskId;
  }

  async undeployModel(registeredModelId: string): Promise<void> {
    await this.client.transport.request({
      method: "POST",
      path: `/_plugins/_ml/models/${registeredModelId}/_undeploy`,
    });
  }

  async getTaskStatus(taskId: string): Promise<{ state: string; modelId?: string }> {
    const response = await this.client.transport.request({
      method: "GET",
      path: `/_plugins/_ml/tasks/${taskId}`,
    });
    const body = response.body as Record<string, unknown>;
    const state = typeof body["state"] === "string" ? body["state"] : "UNKNOWN";
    const modelId = body["model_id"];
    return typeof modelId === "string" ? { state, modelId } : { state };
  }

  /** Poll a task until it reaches COMPLETED or FAILED (max 60 attempts). */
  async waitForTask(taskId: string, intervalMs = 2000): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const { state, modelId } = await this.getTaskStatus(taskId);
      if (state === "COMPLETED" && modelId) return modelId;
      if (state === "FAILED") throw new Error(`ML task ${taskId} failed`);
      await sleep(intervalMs);
    }
    throw new Error(`ML task ${taskId} timed out after 60 attempts`);
  }

  // ----------------------------------------------------------------
  // Ingest pipeline — Tier 1 auto-embedding
  // ----------------------------------------------------------------

  /**
   * Create a text_embedding ingest pipeline that invokes the Tier 1
   * embedding model on the `summary` field and writes the result to
   * the `embedding` field.  Attach to experience_events and
   * memory_semantic indexes so embeddings are generated at index time.
   */
  async ensureEmbeddingIngestPipeline(
    pipelineId: string,
    embeddingModelId: string,
    sourceField = "summary",
    targetField = "embedding",
  ): Promise<void> {
    await this.client.transport.request({
      method: "PUT",
      path: `/_ingest/pipeline/${pipelineId}`,
      body: {
        description: "Tier 1 auto-embedding via OpenSearch ML Commons",
        processors: [
          {
            text_embedding: {
              model_id: embeddingModelId,
              field_map: { [sourceField]: targetField },
            },
          },
        ],
      },
    });
  }

  // ----------------------------------------------------------------
  // Inference — Tier 2 reranking
  // ----------------------------------------------------------------

  /**
   * Re-rank a list of candidate texts against a query using the Tier 2
   * cross-encoder model.  Returns scores in the same order as `candidates`;
   * callers should sort descending by score.
   */
  async rerank(
    rerankerModelId: string,
    query: string,
    candidates: string[],
  ): Promise<RerankResult[]> {
    const response = await this.client.transport.request({
      method: "POST",
      path: `/_plugins/_ml/models/${rerankerModelId}/_predict`,
      body: {
        parameters: {
          texts: [query, ...candidates],
        },
      },
    });

    const output = (response.body as Record<string, unknown>)["inference_results"] as Array<
      Record<string, unknown>
    >;

    return candidates.map((_, index) => ({
      documentIndex: index,
      score: ((output[index]?.["output"] as Array<Record<string, number>>)?.[0]?.["data"] ?? 0) as number,
    }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
