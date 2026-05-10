/**
 * Embedding profile definitions for the OpenSearch memory substrate.
 *
 * A profile bundles everything needed to embed text for one model family
 * and write the resulting vector to a dedicated index field.  Keeping
 * profiles separate per model preserves comparability across benchmark
 * runs and allows model replacement without re-indexing shared fields.
 *
 * Three lanes are defined by the strategy brief:
 *   quality   — Qwen3-Embedding-0.6B (or 4B escalation), dim 1024
 *   efficient — Nomic Embed Text v2, dim 768
 *   hybrid    — BGE-M3 dense vector, dim 1024 (optional, added after dense-only gaps)
 *
 * For local and CI testing, all lanes fall back to a stub provider so no
 * external inference endpoint is required.
 */

/** Supported embedding serving strategies. */
export type EmbeddingProviderKind =
  | "openai_compat"   // Any OpenAI-compatible /v1/embeddings endpoint (Qwen, Nomic, etc.)
  | "vertex"          // Google Vertex AI
  | "ml_commons"      // OpenSearch ML Commons in-cluster model
  | "stub";           // Deterministic zero-vector, for tests

/** Which retrieval lane this profile participates in. */
export type RetrievalLane = "quality" | "efficient" | "hybrid";

export interface EmbeddingProfile {
  /**
   * Stable machine-readable id recorded in every indexed document.
   * Treat this as the version key for re-embedding migrations.
   */
  readonly id: string;

  /** Human-readable family name (e.g. "Qwen3-Embedding-0.6B"). */
  readonly name: string;

  /** Retrieval lane this profile belongs to. */
  readonly lane: RetrievalLane;

  /** Output vector dimension.  Must match the knn_vector field mapping. */
  readonly dimension: number;

  /**
   * OpenSearch field that stores this profile's vector.
   * Example: "embedding_qwen", "embedding_nomic", "embedding_bge_m3".
   */
  readonly vectorField: string;

  /** How to reach the embedding inference service. */
  readonly provider: EmbeddingProviderKind;

  /** Endpoint URL for openai_compat providers. */
  readonly endpoint?: string;

  /** Model identifier sent in the request body. */
  readonly modelId?: string;

  /** API key for openai_compat providers (may be empty for local servers). */
  readonly apiKey?: string;

  /** OpenSearch ML Commons model id (for ml_commons provider). */
  readonly mlCommonsModelId?: string;
}

// ---------------------------------------------------------------------------
// Pre-defined profile templates that callers can reference by lane.
// Dimensions match the brief's first-deployment recommendations.
// ---------------------------------------------------------------------------

export const PROFILE_TEMPLATES: Record<RetrievalLane, Pick<EmbeddingProfile, "dimension" | "vectorField" | "lane">> = {
  quality:   { lane: "quality",   dimension: 1024, vectorField: "embedding_qwen" },
  efficient: { lane: "efficient", dimension: 768,  vectorField: "embedding_nomic" },
  hybrid:    { lane: "hybrid",    dimension: 1024, vectorField: "embedding_bge_m3" },
};

// ---------------------------------------------------------------------------
// Environment-driven profile factory.
// ---------------------------------------------------------------------------

/**
 * Builds active embedding profiles from process environment variables.
 *
 * Active lanes are controlled by EMBEDDING_LANES (comma-separated list,
 * default "quality,efficient").  Each lane reads provider config from
 * lane-prefixed vars, falling back to the global EMBEDDING_* vars.
 *
 * Examples:
 *   EMBEDDING_LANES=quality,efficient
 *   QUALITY_EMBEDDING_PROVIDER=openai_compat
 *   QUALITY_EMBEDDING_ENDPOINT=http://localhost:8080/v1/embeddings
 *   QUALITY_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B
 *   QUALITY_EMBEDDING_APIKEY=
 *   EFFICIENT_EMBEDDING_PROVIDER=openai_compat
 *   EFFICIENT_EMBEDDING_ENDPOINT=http://localhost:8081/v1/embeddings
 *   EFFICIENT_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v2-moe
 */
export function embeddingProfilesFromEnv(): EmbeddingProfile[] {
  const rawLanes = process.env["EMBEDDING_LANES"] ?? "quality,efficient";
  const activeLanes = rawLanes
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l): l is RetrievalLane => l === "quality" || l === "efficient" || l === "hybrid");

  return activeLanes.map((lane) => buildProfileForLane(lane));
}

function buildProfileForLane(lane: RetrievalLane): EmbeddingProfile {
  const prefix = lane.toUpperCase();
  const template = PROFILE_TEMPLATES[lane];

  const provider = envVal(`${prefix}_EMBEDDING_PROVIDER`, "EMBEDDING_PROVIDER", "stub") as EmbeddingProviderKind;

  return {
    id: envVal(`${prefix}_EMBEDDING_MODEL_ID`, undefined, defaultModelId(lane, provider)),
    name: envVal(`${prefix}_EMBEDDING_NAME`, undefined, defaultModelName(lane)),
    lane,
    dimension: Number(envVal(`${prefix}_EMBEDDING_DIMENSION`, undefined, String(template.dimension))),
    vectorField: template.vectorField,
    provider,
    ...(provider === "openai_compat" ? {
      endpoint: envVal(`${prefix}_EMBEDDING_ENDPOINT`, "EMBEDDING_ENDPOINT", "http://localhost:11434/v1/embeddings"),
      modelId: envVal(`${prefix}_EMBEDDING_MODEL`, undefined, defaultModelId(lane, provider)),
      apiKey:  envVal(`${prefix}_EMBEDDING_APIKEY`, "OPENAI_API_KEY", ""),
    } : {}),
    ...(provider === "ml_commons" ? {
      mlCommonsModelId: envVal(`${prefix}_ML_COMMONS_MODEL_ID`, undefined, ""),
    } : {}),
  };
}

function envVal(specific: string, fallback: string | undefined, defaultValue: string): string {
  return process.env[specific]
    ?? (fallback ? process.env[fallback] : undefined)
    ?? defaultValue;
}

function defaultModelId(lane: RetrievalLane, provider: EmbeddingProviderKind): string {
  if (provider === "stub") return `stub-${lane}`;
  const map: Record<RetrievalLane, string> = {
    quality:   "Qwen/Qwen3-Embedding-0.6B",
    efficient: "nomic-ai/nomic-embed-text-v2-moe",
    hybrid:    "BAAI/bge-m3",
  };
  return map[lane];
}

function defaultModelName(lane: RetrievalLane): string {
  const map: Record<RetrievalLane, string> = {
    quality:   "Qwen3-Embedding-0.6B",
    efficient: "Nomic Embed Text v2",
    hybrid:    "BGE-M3",
  };
  return map[lane];
}
