/**
 * Experimental Aiven/OpenSearch ML-node validation lane.
 *
 * This script is intentionally isolated from default CI pass/fail. It records
 * the current cluster topology, the plugins.ml_commons.only_run_on_ml_node
 * setting, ML plugin stats when exposed, and optional predict-path latency.
 *
 * Usage:
 *   OPENSEARCH_URL=https://... pnpm smoke:aiven-ml-node
 *
 * Optional:
 *   AIVEN_ML_NODE_EXPECTED_SETTING=true|false
 *   AIVEN_ML_NODE_EXPECTED_HAS_ML_ROLE=true|false
 *   AIVEN_ML_NODE_TEST_PREDICT_PATH=/_plugins/_ml/_predict/text_embedding/<model-id>
 *   AIVEN_ML_NODE_TEST_PREDICT_BODY='{"text_docs":["hello"],"return_number":true}'
 *   AIVEN_ML_NODE_STRICT=true
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createOpenSearchClient } from "../../packages/memory-opensearch/src/client.js";

type Status = "passed" | "failed" | "skipped";

interface NodeEvidence {
  readonly nodeId: string;
  readonly name: string;
  readonly roles: string[];
  readonly isMlNode: boolean;
}

interface Assertion {
  readonly name: string;
  readonly status: Status;
  readonly expected: string;
  readonly actual: string;
}

interface PredictProbe {
  readonly status: Status;
  readonly path?: string;
  readonly latencyMs?: number;
  readonly error?: string;
}

interface Report {
  readonly runAt: string;
  readonly opensearchUrl: string;
  readonly onlyRunOnMlNode: string;
  readonly settingVerified: boolean;
  readonly topology: {
    readonly nodeCount: number;
    readonly mlNodeCount: number;
    readonly nodes: NodeEvidence[];
  };
  readonly mlStatsAvailable: boolean;
  readonly mlStatsSummary: Record<string, unknown>;
  readonly predictProbe: PredictProbe;
  readonly assertions: Assertion[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const artifactDir = resolve(
  repoRoot,
  process.env["AIVEN_ML_NODE_ARTIFACT_DIR"] ?? "artifacts/smoke/aiven-ml-node-validation",
);
const opensearchUrl = process.env["OPENSEARCH_URL"] ?? "http://localhost:9200";

async function main(): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const client = createOpenSearchClient({
    node: opensearchUrl,
    ...(process.env["OPENSEARCH_USERNAME"] && process.env["OPENSEARCH_PASSWORD"]
      ? {
          auth: {
            username: process.env["OPENSEARCH_USERNAME"],
            password: process.env["OPENSEARCH_PASSWORD"],
          },
        }
      : {}),
    ssl: {
      rejectUnauthorized: process.env["OPENSEARCH_TLS_REJECT_UNAUTHORIZED"] !== "false",
    },
  });

  const setting = await readOnlyRunOnMlNode(client);
  const nodes = await readNodes(client);
  const mlStats = await readMlStats(client);
  const predictProbe = await runPredictProbe(client);

  const assertions = buildAssertions(setting.value, setting.verified, nodes);
  const report: Report = {
    runAt: new Date().toISOString(),
    opensearchUrl,
    onlyRunOnMlNode: setting.value,
    settingVerified: setting.verified,
    topology: {
      nodeCount: nodes.length,
      mlNodeCount: nodes.filter((node) => node.isMlNode).length,
      nodes,
    },
    mlStatsAvailable: mlStats.available,
    mlStatsSummary: mlStats.summary,
    predictProbe,
    assertions,
  };

  await writeFile(join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(artifactDir, "report.md"), renderMarkdown(report));

  process.stdout.write(`[aiven-ml-node] report: ${relative(repoRoot, join(artifactDir, "report.md"))}\n`);

  if (
    process.env["AIVEN_ML_NODE_STRICT"] === "true" &&
    assertions.some((assertion) => assertion.status === "failed")
  ) {
    process.exitCode = 1;
  }
}

async function readOnlyRunOnMlNode(client: ReturnType<typeof createOpenSearchClient>): Promise<{
  readonly value: string;
  readonly verified: boolean;
}> {
  const key = "plugins.ml_commons.only_run_on_ml_node";
  try {
    const response = await client.cluster.getSettings({ include_defaults: true, flat_settings: true });
    const body = response.body as {
      readonly persistent?: Record<string, unknown>;
      readonly transient?: Record<string, unknown>;
      readonly defaults?: Record<string, unknown>;
    };
    const value = body.persistent?.[key] ?? body.transient?.[key] ?? body.defaults?.[key] ?? "not_set";
    return { value: String(value), verified: true };
  } catch (error: unknown) {
    return { value: `unknown: ${errorMessage(error)}`, verified: false };
  }
}

async function readNodes(client: ReturnType<typeof createOpenSearchClient>): Promise<NodeEvidence[]> {
  const response = await client.nodes.info({});
  const body = response.body as {
    readonly nodes?: Record<string, { readonly name?: string; readonly roles?: string[] }>;
  };
  return Object.entries(body.nodes ?? {}).map(([nodeId, node]) => ({
    nodeId,
    name: node.name ?? nodeId,
    roles: node.roles ?? [],
    isMlNode: (node.roles ?? []).includes("ml"),
  }));
}

async function readMlStats(client: ReturnType<typeof createOpenSearchClient>): Promise<{
  readonly available: boolean;
  readonly summary: Record<string, unknown>;
}> {
  try {
    const response = await client.transport.request({
      method: "GET",
      path: "/_plugins/_ml/stats",
    });
    const body = response.body as Record<string, unknown>;
    return {
      available: true,
      summary: summarizeMlStats(body),
    };
  } catch (error: unknown) {
    return {
      available: false,
      summary: { error: errorMessage(error) },
    };
  }
}

async function runPredictProbe(client: ReturnType<typeof createOpenSearchClient>): Promise<PredictProbe> {
  const path = process.env["AIVEN_ML_NODE_TEST_PREDICT_PATH"];
  if (!path) return { status: "skipped" };

  const body = process.env["AIVEN_ML_NODE_TEST_PREDICT_BODY"]
    ? JSON.parse(process.env["AIVEN_ML_NODE_TEST_PREDICT_BODY"])
    : { text_docs: ["OpenSearch ML Commons placement probe"], return_number: true };

  const startedAt = Date.now();
  try {
    await client.transport.request({
      method: "POST",
      path,
      body,
    });
    return { status: "passed", path, latencyMs: Date.now() - startedAt };
  } catch (error: unknown) {
    return { status: "failed", path, latencyMs: Date.now() - startedAt, error: errorMessage(error) };
  }
}

function summarizeMlStats(body: Record<string, unknown>): Record<string, unknown> {
  const nodes = body["nodes"];
  if (typeof nodes !== "object" || nodes === null) return { rawKeys: Object.keys(body) };
  return {
    nodeIds: Object.keys(nodes as Record<string, unknown>),
    rawKeys: Object.keys(body),
  };
}

function buildAssertions(
  setting: string,
  settingVerified: boolean,
  nodes: NodeEvidence[],
): Assertion[] {
  const assertions: Assertion[] = [
    {
      name: "ml commons setting readable",
      status: settingVerified ? "passed" : "failed",
      expected: "cluster settings expose plugins.ml_commons.only_run_on_ml_node",
      actual: setting,
    },
  ];

  const expectedSetting = process.env["AIVEN_ML_NODE_EXPECTED_SETTING"];
  if (expectedSetting === "true" || expectedSetting === "false") {
    assertions.push({
      name: "only_run_on_ml_node expected value",
      status: setting === expectedSetting ? "passed" : "failed",
      expected: expectedSetting,
      actual: setting,
    });
  }

  const expectedHasMlRole = process.env["AIVEN_ML_NODE_EXPECTED_HAS_ML_ROLE"];
  if (expectedHasMlRole === "true" || expectedHasMlRole === "false") {
    const hasMlRole = nodes.some((node) => node.isMlNode);
    assertions.push({
      name: "cluster has expected ml role topology",
      status: String(hasMlRole) === expectedHasMlRole ? "passed" : "failed",
      expected: expectedHasMlRole,
      actual: String(hasMlRole),
    });
  }

  return assertions;
}

function renderMarkdown(report: Report): string {
  const lines = [
    "# Aiven ML Node Validation Report",
    "",
    `Run at: ${report.runAt}`,
    `OpenSearch: ${report.opensearchUrl}`,
    `plugins.ml_commons.only_run_on_ml_node: ${report.onlyRunOnMlNode}`,
    `ML stats available: ${report.mlStatsAvailable}`,
    `Node count: ${report.topology.nodeCount}`,
    `ML node count: ${report.topology.mlNodeCount}`,
    "",
    "## Nodes",
    "",
    ...report.topology.nodes.map((node) =>
      `- ${node.name} (${node.nodeId}): roles ${node.roles.join(", ") || "none"}`,
    ),
    "",
    "## Predict Probe",
    "",
    `- Status: ${report.predictProbe.status}`,
    `- Path: ${report.predictProbe.path ?? "not configured"}`,
    `- Latency: ${report.predictProbe.latencyMs ?? "n/a"} ms`,
    `- Error: ${report.predictProbe.error ?? "none"}`,
    "",
    "## Assertions",
    "",
    ...report.assertions.map((assertion) =>
      `- ${assertion.status}: ${assertion.name}, expected ${assertion.expected}, actual ${assertion.actual}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  process.stderr.write(`[aiven-ml-node] fatal: ${errorMessage(error)}\n`);
  process.exit(1);
});
