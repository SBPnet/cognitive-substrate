/**
 * Embedding model-swap test runner.
 *
 * Exercises the dual-profile (quality + efficient) indexing and retrieval
 * pipeline against a local OpenSearch instance.  Designed for developer
 * iteration on an M4 laptop with docker-compose.ml-test.yml running.
 *
 * Usage:
 *   docker compose -f docker-compose.ml-test.yml up -d
 *   pnpm smoke:embedding
 *
 * Environment:
 *   OPENSEARCH_URL        — defaults to http://localhost:9200
 *   EMBEDDING_LANES       — defaults to "quality,efficient" (both stub)
 *   QUALITY_EMBEDDING_PROVIDER   — "stub" | "openai_compat"
 *   EFFICIENT_EMBEDDING_PROVIDER — "stub" | "openai_compat"
 *   (see apps/workers/ingestion/.env.example for full var list)
 *
 * When QUALITY_EMBEDDING_PROVIDER=openai_compat the script expects an
 * OpenAI-compatible inference server at QUALITY_EMBEDDING_ENDPOINT
 * (e.g. Ollama, llama.cpp, vLLM).  Stub mode works without any server.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { embeddingProfilesFromEnv } from "../../packages/memory-opensearch/src/profiles.js";
import { RETRIEVAL_MODE_VECTOR_FIELD } from "../../packages/memory-opensearch/src/query-builder.js";
import { createOpenSearchClient } from "../../packages/memory-opensearch/src/client.js";
import { modelRegistrySchema } from "../../packages/memory-opensearch/src/schemas.js";
import { buildEmbeddersFromProfiles } from "../../apps/workers/ingestion/src/embedder.js";
import type { EmbeddingProfile } from "../../packages/memory-opensearch/src/profiles.js";
import type { RetrievalMode } from "../../packages/memory-opensearch/src/query-builder.js";

type OpenSearchClient = ReturnType<typeof createOpenSearchClient>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot   = join(scriptDir, "../..");
const artifactDir = process.env["EMBEDDING_SMOKE_ARTIFACT_DIR"]
  ? join(repoRoot, process.env["EMBEDDING_SMOKE_ARTIFACT_DIR"])
  : join(repoRoot, "artifacts/smoke/embedding-model-swap");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

process.env["EMBEDDING_LANES"] ??= "quality,efficient";
process.env["QUALITY_EMBEDDING_PROVIDER"]   ??= "stub";
process.env["EFFICIENT_EMBEDDING_PROVIDER"] ??= "stub";

const OPENSEARCH_URL = process.env["OPENSEARCH_URL"] ?? "http://localhost:9200";
const INDEX_NAME     = "embedding_model_swap_test";
const K              = 3;

// Cognitive artifact sample corpus — mirrors brief's recommended types.
const CORPUS: Array<{ id: string; artifactType: string; summary: string; structuredTerms: string }> = [
  {
    id: "art-001",
    artifactType: "log_pattern",
    summary: "Authentication service latency increased by 340ms over 5 minutes during peak traffic",
    structuredTerms: "auth-service latency HTTP_504 us-east-1 v2.4.1",
  },
  {
    id: "art-002",
    artifactType: "metric_anomaly",
    summary: "Disk IO saturation reached 98% on storage node, causing write queue backlog",
    structuredTerms: "disk-io saturation storage-node write-queue DISK_FULL us-west-2",
  },
  {
    id: "art-003",
    artifactType: "incident_fragment",
    summary: "Deployment rollout paused after elevated HTTP 500 error rate exceeded threshold",
    structuredTerms: "deploy HTTP_500 rollout canary payment-service v3.1.0-rc2",
  },
  {
    id: "art-004",
    artifactType: "log_pattern",
    summary: "Connection pool exhausted for downstream database, queries timing out",
    structuredTerms: "connection-pool db-timeout postgres orders-service pool-exhausted",
  },
  {
    id: "art-005",
    artifactType: "deployment_event",
    summary: "Feature flag enabled for regional traffic split, memory footprint increased",
    structuredTerms: "feature-flag traffic-split memory region-split v2.5.0 eu-west-1",
  },
  {
    id: "art-006",
    artifactType: "metric_anomaly",
    summary: "CPU spike on API gateway correlated with upstream retry storm from mobile clients",
    structuredTerms: "cpu-spike api-gateway retry-storm mobile-client rate-limit",
  },
  {
    id: "art-007",
    artifactType: "incident_fragment",
    summary: "Authentication tokens expiring prematurely due to clock drift between nodes",
    structuredTerms: "auth-token clock-drift ntp JWT_EXPIRED auth-service v2.4.1",
  },
  {
    id: "art-008",
    artifactType: "operator_action",
    summary: "On-call engineer increased connection pool size from 50 to 200 to resolve timeout storm",
    structuredTerms: "connection-pool postgres remediation on-call orders-service",
  },
];

// Natural-language incident queries — test semantic recall.
const NL_QUERIES = [
  "authentication latency spike during peak load",
  "database connection exhaustion timeout",
  "deployment causing elevated error rates",
];

// Identifier-heavy queries — test lexical recall.
const LEXICAL_QUERIES = [
  "HTTP_504 auth-service us-east-1",
  "DISK_FULL storage-node us-west-2",
  "JWT_EXPIRED clock-drift v2.4.1",
];

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

interface QueryResult {
  readonly query: string;
  readonly queryType: "semantic" | "lexical";
  readonly mode: RetrievalMode;
  readonly topK: Array<{ id: string; score: number; artifactType: string }>;
  readonly latencyMs: number;
}

interface ProfileReport {
  readonly profile: EmbeddingProfile;
  readonly indexTimeMs: number;
  readonly vectorFieldPresent: boolean;
  readonly queryResults: QueryResult[];
}

interface Report {
  readonly runAt: string;
  readonly opensearchUrl: string;
  readonly activeLanes: string[];
  readonly totalArtifacts: number;
  readonly profiles: ProfileReport[];
  readonly mlNodeSettingVerified: boolean;
  readonly mlNodeSettingValue: string;
  readonly assertions: Array<{ name: string; passed: boolean; actual: string }>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("=== Embedding Model-Swap Test ===");
  log(`OpenSearch: ${OPENSEARCH_URL}`);
  log(`Artifact dir: ${artifactDir}`);

  await mkdir(artifactDir, { recursive: true });

  const client = createOpenSearchClient({
    node: OPENSEARCH_URL,
    ssl: { rejectUnauthorized: false },
  });

  await waitForOpenSearch(client);

  const { mlNodeSettingValue, mlNodeSettingVerified } = await checkMlNodeSetting(client);
  log(`ML node setting — only_run_on_ml_node: ${mlNodeSettingValue} (verified: ${mlNodeSettingVerified})`);

  const profiles = embeddingProfilesFromEnv();
  log(`Active profiles: ${profiles.map((p) => `${p.lane}/${p.id}`).join(", ")}`);

  const profiledEmbedders = buildEmbeddersFromProfiles(profiles);

  // Build a shared index that holds all profile vectors.
  await ensureTestIndex(client, profiles);
  await recordProfiles(client, profiles);

  // Index the corpus through every active profile in one pass.
  log(`Indexing ${CORPUS.length} artifacts across ${profiles.length} profile(s)...`);
  const indexStart = Date.now();
  await indexCorpus(client, profiledEmbedders);
  const indexTimeMs = Date.now() - indexStart;
  log(`Indexed in ${indexTimeMs} ms`);

  // Allow refresh.
  await sleep(1500);

  // Run retrieval tests per profile/lane.
  const profileReports: ProfileReport[] = [];

  for (const { profile, client: embedder } of profiledEmbedders) {
    const mode = profile.lane as RetrievalMode;
    log(`\n--- Retrieval mode: ${mode} (${profile.id}) ---`);

    const vectorFieldPresent = await verifyVectorField(client, profile.vectorField);
    log(`  vector field "${profile.vectorField}" present: ${vectorFieldPresent}`);

    const queryResults: QueryResult[] = [];

    for (const query of NL_QUERIES) {
      const result = await runQuery(client, embedder, query, mode, "semantic");
      log(`  [semantic] "${query}"`);
      result.topK.forEach((h, i) => log(`    #${i + 1} ${h.id} (${h.artifactType}) score=${h.score.toFixed(4)}`));
      queryResults.push(result);
    }

    for (const query of LEXICAL_QUERIES) {
      const result = await runQuery(client, embedder, query, mode, "lexical");
      log(`  [lexical]  "${query}"`);
      result.topK.forEach((h, i) => log(`    #${i + 1} ${h.id} (${h.artifactType}) score=${h.score.toFixed(4)}`));
      queryResults.push(result);
    }

    profileReports.push({
      profile,
      indexTimeMs,
      vectorFieldPresent,
      queryResults,
    });
  }

  const report: Report = {
    runAt: new Date().toISOString(),
    opensearchUrl: OPENSEARCH_URL,
    activeLanes: profiles.map((p) => p.lane),
    totalArtifacts: CORPUS.length,
    profiles: profileReports,
    mlNodeSettingVerified,
    mlNodeSettingValue,
    assertions: buildAssertions(profileReports),
  };

  await writeReports(report);
  log("\n=== Done ===");
  log(`Report written to ${artifactDir}/report.json`);
}

function buildAssertions(profileReports: ProfileReport[]): Array<{ name: string; passed: boolean; actual: string }> {
  const assertions: Array<{ name: string; passed: boolean; actual: string }> = [];
  for (const profileReport of profileReports) {
    assertions.push({
      name: `${profileReport.profile.lane} vector field present`,
      passed: profileReport.vectorFieldPresent,
      actual: String(profileReport.vectorFieldPresent),
    });
    assertions.push({
      name: `${profileReport.profile.lane} retrieval returned results`,
      passed: profileReport.queryResults.every((result) => result.topK.length > 0),
      actual: profileReport.queryResults.map((result) => `${result.query}:${result.topK.length}`).join(", "),
    });
  }
  return assertions;
}

// ---------------------------------------------------------------------------
// OpenSearch helpers
// ---------------------------------------------------------------------------

async function waitForOpenSearch(client: OpenSearchClient): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const health = await client.cluster.health({});
      if (health.body.status === "green" || health.body.status === "yellow") {
        log(`OpenSearch cluster status: ${health.body.status}`);
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(2_000);
  }
  throw new Error(`OpenSearch at ${OPENSEARCH_URL} did not become ready in 60s`);
}

async function checkMlNodeSetting(client: OpenSearchClient): Promise<{
  mlNodeSettingValue: string;
  mlNodeSettingVerified: boolean;
}> {
  const KEY = "plugins.ml_commons.only_run_on_ml_node";
  try {
    const response = await client.cluster.getSettings({ include_defaults: true, flat_settings: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = response.body as any;
    // flat_settings=true merges all tiers under their respective keys.
    const value: unknown =
      body?.persistent?.[KEY] ??
      body?.transient?.[KEY] ??
      body?.defaults?.[KEY] ??
      "not_set";
    return { mlNodeSettingValue: String(value), mlNodeSettingVerified: true };
  } catch {
    return { mlNodeSettingValue: "unknown", mlNodeSettingVerified: false };
  }
}

async function ensureTestIndex(
  client: OpenSearchClient,
  profiles: EmbeddingProfile[],
): Promise<void> {
  try {
    await client.indices.delete({ index: INDEX_NAME });
  } catch {
    // index may not exist — ignore
  }

  const vectorProperties: Record<string, unknown> = {};
  for (const profile of profiles) {
    vectorProperties[profile.vectorField] = {
      type: "knn_vector",
      dimension: profile.dimension,
      method: { name: "hnsw", engine: "faiss", space_type: "l2", parameters: { m: 8, ef_construction: 64 } },
    };
  }

  await client.indices.create({
    index: INDEX_NAME,
    body: {
      settings: {
        index: {
          knn: true,
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      },
      mappings: {
        properties: {
          artifact_id:      { type: "keyword" },
          artifact_type:    { type: "keyword" },
          summary:          { type: "text", analyzer: "english" },
          structured_terms: { type: "text", analyzer: "standard" },
          embedding_meta: {
            type: "object",
            dynamic: false,
            properties: {
              profile_id:  { type: "keyword" },
              model_name:  { type: "keyword" },
              lane:        { type: "keyword" },
              indexed_at:  { type: "date" },
            },
          },
          ...vectorProperties,
        },
      },
    },
  });

  log(`Test index "${INDEX_NAME}" created with ${profiles.length} vector field(s).`);
}

async function recordProfiles(client: OpenSearchClient, profiles: EmbeddingProfile[]): Promise<void> {
  const registryIndex = "model_registry";
  const exists = await client.indices.exists({ index: registryIndex });
  if (!exists.body) {
    await client.indices.create({ index: registryIndex, body: modelRegistrySchema });
  }

  for (const profile of profiles) {
    await client.index({
      index: registryIndex,
      id: `embedding-model-swap-${profile.id}`,
      body: {
        profile_id: profile.id,
        lane: profile.lane,
        model_id: profile.modelId ?? profile.id,
        model_name: profile.name,
        provider: profile.provider,
        vector_field: profile.vectorField,
        dimension: profile.dimension,
        endpoint: profile.endpoint ?? "",
        ml_commons_model_id: profile.mlCommonsModelId ?? "",
        deployment_status: "smoke-tested",
        license_notes: "see upstream model card",
        registered_at: new Date().toISOString(),
      },
      refresh: "wait_for",
    });
  }
}

async function indexCorpus(
  client: OpenSearchClient,
  profiledEmbedders: ReturnType<typeof buildEmbeddersFromProfiles>,
): Promise<void> {
  for (const artifact of CORPUS) {
    const vectorFields: Record<string, ReadonlyArray<number>> = {};
    let primaryVec: ReadonlyArray<number> | undefined;

    for (const { profile, client: embedder } of profiledEmbedders) {
      try {
        const vec = await embedder.embed(artifact.summary);
        vectorFields[profile.vectorField] = vec;
        if (!primaryVec) primaryVec = vec;
      } catch (err: unknown) {
        process.stderr.write(`[embed] profile ${profile.id} failed for ${artifact.id}: ${err}\n`);
      }
    }

    if (!primaryVec) throw new Error(`All profiles failed for artifact ${artifact.id}`);

    const primary = profiledEmbedders[0]!.profile;
    await client.index({
      index: INDEX_NAME,
      id: artifact.id,
      body: {
        artifact_id:      artifact.id,
        artifact_type:    artifact.artifactType,
        summary:          artifact.summary,
        structured_terms: artifact.structuredTerms,
        embedding_meta: {
          profile_id: primary.id,
          model_name: primary.name,
          lane:       primary.lane,
          indexed_at: new Date().toISOString(),
        },
        ...vectorFields,
      },
      refresh: "wait_for",
    });
  }
}

async function verifyVectorField(client: OpenSearchClient, fieldName: string): Promise<boolean> {
  try {
    const mapping = await client.indices.getMapping({ index: INDEX_NAME });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties = (mapping.body as any)[INDEX_NAME]?.mappings?.properties ?? {};
    return fieldName in properties && (properties as Record<string, { type?: string }>)[fieldName]?.type === "knn_vector";
  } catch {
    return false;
  }
}

async function runQuery(
  client: OpenSearchClient,
  embedder: { embed(text: string): Promise<ReadonlyArray<number>> },
  query: string,
  mode: RetrievalMode,
  queryType: "semantic" | "lexical",
): Promise<QueryResult> {
  const vectorField = RETRIEVAL_MODE_VECTOR_FIELD[mode];
  const start = Date.now();

  const queryVec = await embedder.embed(query);

  // Hybrid: BM25 must-clause + kNN should-clause fused via bool.
  const body = {
    size: K,
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query,
              fields: ["summary^2", "structured_terms"],
              type: "best_fields",
            },
          },
          {
            knn: {
              [vectorField]: {
                vector: Array.from(queryVec),
                k: K,
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
    _source: { excludes: Object.values(RETRIEVAL_MODE_VECTOR_FIELD) },
  };

  const result = await client.search({ index: INDEX_NAME, body });
  const latencyMs = Date.now() - start;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hits: Array<any> = (result.body as any).hits?.hits ?? [];

  return {
    query,
    queryType,
    mode,
    topK: hits.map((h) => ({
      id:           h._source.artifact_id as string,
      score:        h._score as number,
      artifactType: h._source.artifact_type as string,
    })),
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

async function writeReports(report: Report): Promise<void> {
  const jsonPath = join(artifactDir, "report.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  const mdLines: string[] = [
    "# Embedding Model-Swap Test Report",
    "",
    `Run at: ${report.runAt}`,
    `OpenSearch: ${report.opensearchUrl}`,
    `Total artifacts: ${report.totalArtifacts}`,
    `Active lanes: ${report.activeLanes.join(", ")}`,
    `plugins.ml_commons.only_run_on_ml_node: ${report.mlNodeSettingValue}`,
    "",
  ];

  for (const profileReport of report.profiles) {
    const p = profileReport.profile;
    mdLines.push(`## Profile: ${p.lane} / ${p.name} (${p.id})`);
    mdLines.push("");
    mdLines.push(`- Vector field: \`${p.vectorField}\` — present in index: ${profileReport.vectorFieldPresent}`);
    mdLines.push(`- Dimension: ${p.dimension}`);
    mdLines.push(`- Provider: ${p.provider}`);
    mdLines.push(`- Index time: ${profileReport.indexTimeMs} ms (total for all artifacts)`);
    mdLines.push("");

    for (const qr of profileReport.queryResults) {
      mdLines.push(`### [${qr.queryType}] "${qr.query}"`);
      mdLines.push(`Latency: ${qr.latencyMs} ms`);
      if (qr.topK.length === 0) {
        mdLines.push("No results returned.");
      } else {
        qr.topK.forEach((h, i) => {
          mdLines.push(`${i + 1}. \`${h.id}\` (${h.artifactType}) — score ${h.score.toFixed(4)}`);
        });
      }
      mdLines.push("");
    }
  }

  mdLines.push("## Assertions");
  mdLines.push("");
  for (const assertion of report.assertions) {
    mdLines.push(`- ${assertion.passed ? "passed" : "failed"}: ${assertion.name}, actual ${assertion.actual}`);
  }
  mdLines.push("");

  const mdPath = join(artifactDir, "report.md");
  await writeFile(mdPath, mdLines.join("\n"));
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`[embedding-model-swap] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
