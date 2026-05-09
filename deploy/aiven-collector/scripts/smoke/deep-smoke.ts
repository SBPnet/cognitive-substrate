import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

type Status = "passed" | "failed" | "skipped";

interface PhaseReport {
  readonly name: string;
  readonly status: Status;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly logPath?: string;
  readonly error?: string;
}

interface AssertionReport {
  readonly name: string;
  readonly status: Status;
  readonly expected: string;
  readonly actual: string;
}

interface PackageCoverage {
  readonly name: string;
  readonly path: string;
  readonly kind: "app" | "package";
  readonly evidence: string[];
  readonly runtimeSources: string[];
}

interface ServiceHandle {
  readonly name: string;
  readonly cwd: string;
  readonly logPath: string;
  readonly process: ChildProcessWithoutNullStreams;
  readonly stream: WriteStream;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface Report {
  runId: string;
  status: Status;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  gitSha?: string;
  artifactDir: string;
  phases: PhaseReport[];
  assertions: AssertionReport[];
  services: Array<{
    readonly name: string;
    readonly cwd: string;
    readonly logPath: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  coverage: PackageCoverage[];
  metrics: Record<string, number | string>;
  error?: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactDir = resolve(
  repoRoot,
  process.env["SMOKE_ARTIFACT_DIR"] ?? join("artifacts", "smoke", `deep-smoke-${runId}`),
);
const logsDir = join(artifactDir, "logs");
const reportJsonPath = join(artifactDir, "deep-smoke-report.json");
const reportMarkdownPath = join(artifactDir, "deep-smoke-report.md");
const startedAtMs = Date.now();

const report: Report = {
  runId,
  status: "failed",
  startedAt: new Date(startedAtMs).toISOString(),
  artifactDir: relative(repoRoot, artifactDir),
  phases: [],
  assertions: [],
  services: [],
  coverage: [],
  metrics: {},
};

const services: ServiceHandle[] = [];
let cleaningUp = false;

const localSmokeEnv: Record<string, string> = {
  KAFKA_BROKERS: "localhost:9092",
  KAFKA_SSL: "false",
  KAFKAJS_NO_PARTITIONER_WARNING: "1",
  OPENSEARCH_URL: "http://localhost:9200",
  OPENSEARCH_TLS_REJECT_UNAUTHORIZED: "false",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_DATABASE: "cognitive_substrate_telemetry",
  CLICKHOUSE_USERNAME: "default",
  CLICKHOUSE_PASSWORD: "",
  S3_BUCKET: "cognitive-substrate-episodic",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "http://localhost:9001",
  S3_ACCESS_KEY_ID: "minio",
  S3_SECRET_ACCESS_KEY: "minio123",
  S3_FORCE_PATH_STYLE: "true",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
  EMBEDDING_PROVIDER: "stub",
  ENVIRONMENT: "smoke",
};

const hostedEnvKeys = [
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_PORT",
  "OPENSEARCH_USERNAME",
  "OPENSEARCH_PASSWORD",
  "KAFKA_SASL_MECHANISM",
  "KAFKA_SASL_USERNAME",
  "KAFKA_SASL_PASSWORD",
  "OPENAI_API_KEY",
] as const;

const appServices = [
  { name: "ingestion", cwd: "apps/workers/ingestion", command: "node", args: ["dist/main.js"] },
  { name: "consolidation", cwd: "apps/workers/consolidation", command: "node", args: ["dist/main.js"] },
  { name: "telemetry", cwd: "apps/workers/telemetry", command: "node", args: ["dist/main.js"] },
  { name: "pattern", cwd: "apps/workers/pattern", command: "node", args: ["dist/main.js"] },
  { name: "reinforcement", cwd: "apps/workers/reinforcement", command: "node", args: ["dist/main.js"] },
  { name: "orchestrator", cwd: "apps/orchestrator", command: "node", args: ["dist/main.js"] },
  { name: "api", cwd: "apps/api", command: "node", args: ["dist/main.js"] },
  {
    name: "web",
    cwd: "apps/web",
    command: "pnpm",
    args: ["dev"],
    env: { NEXT_PUBLIC_API_URL: "http://localhost:3001" },
  },
] as const;

async function main(): Promise<void> {
  await mkdir(logsDir, { recursive: true });
  report.gitSha = await captureCommand("git", ["rev-parse", "--short", "HEAD"]).catch(() => "unknown");

  try {
    report.coverage = await buildCoverageModel();
    await runPhase("package-baseline", () =>
      runCommand("package-baseline", "pnpm", ["smoke:packages"]),
    );
    await runPhase("aiven-collector-contract", () =>
      runCommand("aiven-collector-contract", "pnpm", [
        "tsx",
        "scripts/smoke/aiven-collector-contract.ts",
      ]),
    );
    await runPhase("open-ended-probe", () =>
      runCommand("open-ended-probe", "node", ["dist/main.js"], {
        cwd: join(repoRoot, "apps/orchestrator"),
        env: { ...localSmokeEnv, COGNITIVE_SUBSTRATE_MODE: "open-ended" },
      }),
    );
    await runPhase("copy-env-examples", copyEnvExamples);
    await runPhase("infra-start", () =>
      runCommand("infra-start", "docker", ["compose", "-f", "docker-compose.smoke.yml", "up", "-d"]),
    );
    await runPhase("infra-readiness", waitForInfrastructure);
    await runPhase("init-kafka-topics", () =>
      runCommand("init-kafka-topics", "pnpm", ["tsx", "scripts/smoke/init-kafka-topics.ts"], {
        env: localSmokeEnv,
      }),
    );
    await runPhase("init-clickhouse", () =>
      runCommand("init-clickhouse", "pnpm", ["tsx", "scripts/smoke/init-clickhouse.ts"], {
        env: localSmokeEnv,
      }),
    );
    await runPhase("app-start", startApplications);
    await runPhase("app-readiness", waitForApplications);
    await runPhase("cognitive-flow", () =>
      runCommand("feed-experiences", "pnpm", ["tsx", "scripts/smoke/feed-experiences.ts"], {
        env: {
          ...localSmokeEnv,
          API_URL: "http://localhost:3001",
          WAIT_SECONDS: process.env["WAIT_SECONDS"] ?? "12",
          CONSOLIDATE: process.env["CONSOLIDATE"] ?? "true",
        },
      }),
    );
    await runPhase("telemetry-flow", async () => {
      await runCommand("produce-telemetry", "pnpm", ["tsx", "scripts/smoke/produce-telemetry.ts"], {
        env: {
          ...localSmokeEnv,
          COUNT: process.env["TELEMETRY_COUNT"] ?? "16",
          INTERVAL_MS: process.env["TELEMETRY_INTERVAL_MS"] ?? "50",
        },
      });
      await waitForClickHouseMinimum("metrics_raw", Number(process.env["MIN_METRICS_RAW_COUNT"] ?? "1"));
      await waitForClickHouseMinimum("cognitive_events", Number(process.env["MIN_COGNITIVE_EVENTS_COUNT"] ?? "1"));
    });
    await runPhase("assertions", runAssertions);

    report.status = report.assertions.every((assertion) => assertion.status === "passed")
      ? "passed"
      : "failed";
  } catch (error: unknown) {
    report.error = errorMessage(error);
    report.status = "failed";
    process.exitCode = 1;
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAtMs;
    report.services = services.map((service) => ({
      name: service.name,
      cwd: relative(repoRoot, service.cwd),
      logPath: relative(repoRoot, service.logPath),
      exitCode: service.exitCode,
      signal: service.signal,
    }));
    await writeReports();
  }

  if (report.status !== "passed") {
    process.exitCode = 1;
  }
}

async function runPhase(name: string, action: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  try {
    await action();
    report.phases.push({
      name,
      status: "passed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      logPath: relative(repoRoot, join(logsDir, `${name}.log`)),
    });
  } catch (error: unknown) {
    report.phases.push({
      name,
      status: "failed",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      logPath: relative(repoRoot, join(logsDir, `${name}.log`)),
      error: errorMessage(error),
    });
    throw error;
  }
}

async function runCommand(
  logName: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const logPath = join(logsDir, `${logName}.log`);
    const stream = createWriteStream(logPath, { flags: "a" });
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: mergeEnv(options.env),
      shell: false,
    });

    stream.write(`$ ${command} ${args.join(" ")}\n`);
    child.stdout.on("data", (chunk: Buffer) => stream.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => stream.write(chunk));
    child.on("error", (error) => {
      stream.end();
      reject(error);
    });
    child.on("close", (code, signal) => {
      stream.write(`\n[deep-smoke] exit_code=${code} signal=${signal ?? ""}\n`);
      stream.end();
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${logName} failed with exit code ${code ?? `signal ${signal}`}`));
      }
    });
  });
}

async function captureCommand(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: mergeEnv(), shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

async function copyEnvExamples(): Promise<void> {
  for (const service of appServices) {
    const dir = join(repoRoot, service.cwd);
    const envPath = join(dir, ".env");
    const examplePath = join(dir, ".env.example");
    try {
      await access(envPath);
    } catch {
      try {
        const contents = await readFile(examplePath, "utf8");
        await writeFile(envPath, contents);
      } catch {
        // Some apps may not need dotenv files.
      }
    }
  }
}

async function waitForInfrastructure(): Promise<void> {
  await waitForHttp("opensearch", "http://localhost:9200/_cluster/health", 120_000);
  await waitForHttp("clickhouse", "http://localhost:8123/ping", 120_000);
  await waitForKafka(120_000);
}

async function waitForApplications(): Promise<void> {
  await waitForHttp("api", "http://localhost:3001/health", 120_000);
  await waitForHttp("web", "http://localhost:3000", 120_000);
}

async function waitForHttp(name: string, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    assertServicesAlive();
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error: unknown) {
      lastError = errorMessage(error);
    }
    await sleep(2_000);
  }
  throw new Error(`${name} did not become ready: ${lastError}`);
}

async function waitForKafka(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await captureCommand("docker", [
        "compose",
        "-f",
        "docker-compose.smoke.yml",
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-topics.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--list",
      ]);
      return;
    } catch (error: unknown) {
      lastError = errorMessage(error);
      await sleep(3_000);
    }
  }
  throw new Error(`kafka did not become ready: ${lastError}`);
}

async function startApplications(): Promise<void> {
  for (const service of appServices) {
    const cwd = join(repoRoot, service.cwd);
    const env = {
      ...parseEnvFile(await readOptionalFile(join(cwd, ".env"))),
      ...localSmokeEnv,
      ...("env" in service ? service.env : {}),
    };
    const handle = await startService(service.name, cwd, service.command, service.args, env);
    services.push(handle);
  }

  await sleep(5_000);
  assertServicesAlive();
}

async function startService(
  name: string,
  cwd: string,
  command: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<ServiceHandle> {
  const logPath = join(logsDir, `service-${name}.log`);
  const stream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, [...args], {
    cwd,
    env: mergeEnv(env),
    shell: false,
  });
  const handle: ServiceHandle = {
    name,
    cwd,
    logPath,
    process: child,
    stream,
    exitCode: null,
    signal: null,
  };

  stream.write(`$ ${command} ${args.join(" ")}\n`);
  child.stdout.on("data", (chunk: Buffer) => stream.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => stream.write(chunk));
  child.on("exit", (code, signal) => {
    handle.exitCode = code;
    handle.signal = signal;
    stream.write(`\n[deep-smoke] exit_code=${code} signal=${signal ?? ""}\n`);
  });
  child.on("error", (error) => {
    stream.write(`[deep-smoke] process error: ${errorMessage(error)}\n`);
  });

  return handle;
}

function assertServicesAlive(): void {
  if (cleaningUp) return;
  const failed = services.filter((service) => service.exitCode !== null || service.signal !== null);
  if (failed.length > 0) {
    throw new Error(
      `service process exited early: ${failed
        .map((service) => `${service.name}=${service.exitCode ?? service.signal}`)
        .join(", ")}`,
    );
  }
}

async function runAssertions(): Promise<void> {
  const experienceCount = await getOpenSearchCount("experience_events");
  const semanticCount = await getOpenSearchCount("memory_semantic");
  const auditCount = await getOpenSearchCount("audit_events");
  const agentActivityCount = await getOpenSearchCount("agent_activity");
  const metricsRawCount = await getClickHouseCount("metrics_raw");
  const cognitiveEventsCount = await getClickHouseCount("cognitive_events");
  const sessionId = await smokeSessionId();
  const traceTotal = sessionId ? await getApiTotal(`/api/sessions/${sessionId}/memories/trace?limit=20`) : 0;
  const agentTotal = sessionId ? await getApiTotal(`/api/sessions/${sessionId}/agents?limit=20`, "activities") : 0;

  report.metrics["opensearch.experience_events"] = experienceCount;
  report.metrics["opensearch.memory_semantic"] = semanticCount;
  report.metrics["opensearch.audit_events"] = auditCount;
  report.metrics["opensearch.agent_activity"] = agentActivityCount;
  report.metrics["clickhouse.metrics_raw"] = metricsRawCount;
  report.metrics["clickhouse.cognitive_events"] = cognitiveEventsCount;
  report.metrics["api.trace_events"] = traceTotal;
  report.metrics["api.agent_activities"] = agentTotal;

  addMinimumAssertion("opensearch experience_events", experienceCount, 1);
  addMinimumAssertion("opensearch memory_semantic", semanticCount, 1);
  addMinimumAssertion("opensearch audit_events", auditCount, 1);
  addMinimumAssertion("opensearch agent_activity", agentActivityCount, 1);
  addMinimumAssertion("clickhouse metrics_raw", metricsRawCount, 1);
  addMinimumAssertion("clickhouse cognitive_events", cognitiveEventsCount, 1);
  addMinimumAssertion("api trace events", traceTotal, 1);
  addMinimumAssertion("api agent activities", agentTotal, 1);
  addProcessAssertion();

  const failed = report.assertions.filter((assertion) => assertion.status === "failed");
  if (failed.length > 0) {
    throw new Error(`${failed.length} deep smoke assertion(s) failed`);
  }
}

async function smokeSessionId(): Promise<string | undefined> {
  const log = await readFile(join(logsDir, "feed-experiences.log"), "utf8").catch(() => "");
  return /Session: ([0-9a-f-]+)/.exec(log)?.[1] ?? /Created session ([0-9a-f-]+)/.exec(log)?.[1];
}

async function getApiTotal(path: string, arrayField = "events"): Promise<number> {
  const response = await fetch(`http://localhost:3001${path}`);
  if (!response.ok) return 0;
  const body = (await response.json()) as { total?: number; [key: string]: unknown };
  if (typeof body.total === "number") return body.total;
  const items = body[arrayField];
  return Array.isArray(items) ? items.length : 0;
}

function addMinimumAssertion(name: string, actual: number, minimum: number): void {
  report.assertions.push({
    name,
    status: actual >= minimum ? "passed" : "failed",
    expected: `>= ${minimum}`,
    actual: String(actual),
  });
}

function addProcessAssertion(): void {
  const failed = services.filter((service) => service.exitCode !== null || service.signal !== null);
  report.assertions.push({
    name: "service processes alive",
    status: failed.length === 0 ? "passed" : "failed",
    expected: "all services alive through assertion phase",
    actual: failed.length === 0 ? "all alive" : failed.map((service) => service.name).join(", "),
  });
}

async function waitForClickHouseMinimum(table: string, minimum: number): Promise<void> {
  const deadline = Date.now() + Number(process.env["TELEMETRY_WAIT_MS"] ?? "30000");
  let count = 0;
  while (Date.now() < deadline) {
    assertServicesAlive();
    count = await getClickHouseCount(table).catch(() => 0);
    if (count >= minimum) return;
    await sleep(2_000);
  }
  throw new Error(`${table} count ${count} stayed below minimum ${minimum}`);
}

async function getOpenSearchCount(index: string): Promise<number> {
  const response = await fetch(`http://localhost:9200/${index}/_count`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return 0;
  const body = (await response.json()) as { count?: number };
  return body.count ?? 0;
}

async function getClickHouseCount(table: string): Promise<number> {
  const query = `SELECT count() AS count FROM ${table} FORMAT JSON`;
  const url = new URL("http://localhost:8123/");
  url.searchParams.set("database", "cognitive_substrate_telemetry");
  url.searchParams.set("query", query);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ClickHouse count failed for ${table}: ${response.status}`);
  }
  const body = (await response.json()) as { data?: Array<{ count?: string | number }> };
  const rawCount = body.data?.[0]?.count ?? 0;
  return typeof rawCount === "number" ? rawCount : Number(rawCount);
}

async function buildCoverageModel(): Promise<PackageCoverage[]> {
  const packages = await discoverWorkspacePackages();
  const byName = new Map(packages.map((pkg) => [pkg.packageJson.name, pkg]));
  const runtimeDirect = new Map<string, Set<string>>();
  const runtimeTransitive = new Map<string, Set<string>>();
  const launchedAppNames = new Set<string>();

  for (const service of appServices) {
    const pkg = packages.find((candidate) => candidate.path === service.cwd);
    if (!pkg.packageJson.name) continue;
    launchedAppNames.add(pkg.packageJson.name);
    const sourceImports = await sourceImportedWorkspacePackages(join(repoRoot, service.cwd, "src"));
    for (const dep of sourceImports) {
      mapAdd(runtimeDirect, dep, service.name);
      collectTransitiveDeps(dep, byName, runtimeTransitive, service.name, new Set());
    }
  }

  mapAdd(runtimeDirect, "@cognitive-substrate/constitution-engine", "open-ended-probe");
  mapAdd(runtimeDirect, "@cognitive-substrate/development-engine", "open-ended-probe");

  return packages.map((pkg) => {
    const evidence = new Set<string>();
    const runtimeSources = new Set<string>();
    const scripts = pkg.packageJson.scripts ?? {};

    if (scripts["build"]) evidence.add("build");
    if (scripts["typecheck"]) evidence.add("typecheck");
    if (scripts["test"]) evidence.add("unit-test");
    if (pkg.kind === "package") evidence.add("entrypoint-import");
    if (pkg.packageJson.name && launchedAppNames.has(pkg.packageJson.name)) {
      evidence.add("launched-service");
    }
    if (pkg.packageJson.name && runtimeDirect.has(pkg.packageJson.name)) {
      evidence.add("runtime-direct");
      for (const source of runtimeDirect.get(pkg.packageJson.name) ?? []) runtimeSources.add(source);
    }
    if (pkg.packageJson.name && runtimeTransitive.has(pkg.packageJson.name)) {
      evidence.add("runtime-transitive");
      for (const source of runtimeTransitive.get(pkg.packageJson.name) ?? []) runtimeSources.add(source);
    }

    return {
      name: pkg.packageJson.name ?? pkg.path,
      path: pkg.path,
      kind: pkg.kind,
      evidence: [...evidence].sort(),
      runtimeSources: [...runtimeSources].sort(),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

async function discoverWorkspacePackages(): Promise<Array<{
  readonly path: string;
  readonly kind: "app" | "package";
  readonly packageJson: PackageJson;
}>> {
  const results: Array<{
    readonly path: string;
    readonly kind: "app" | "package";
    readonly packageJson: PackageJson;
  }> = [];

  for (const path of await childPackageJsonPaths(join(repoRoot, "packages"))) {
    results.push({
      path: relative(repoRoot, dirname(path)),
      kind: "package",
      packageJson: JSON.parse(await readFile(path, "utf8")) as PackageJson,
    });
  }
  for (const path of await childPackageJsonPaths(join(repoRoot, "apps"))) {
    results.push({
      path: relative(repoRoot, dirname(path)),
      kind: "app",
      packageJson: JSON.parse(await readFile(path, "utf8")) as PackageJson,
    });
  }
  for (const path of await childPackageJsonPaths(join(repoRoot, "apps/workers"))) {
    results.push({
      path: relative(repoRoot, dirname(path)),
      kind: "app",
      packageJson: JSON.parse(await readFile(path, "utf8")) as PackageJson,
    });
  }

  return results;
}

async function childPackageJsonPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(root, entry.name, "package.json");
    try {
      const info = await stat(packageJsonPath);
      if (info.isFile()) paths.push(packageJsonPath);
    } catch {
      // Not a workspace package directory.
    }
  }
  return paths;
}

async function sourceImportedWorkspacePackages(root: string): Promise<Set<string>> {
  const imports = new Set<string>();
  const files = await sourceFiles(root);
  const importPattern =
    /(?:from\s+["'](@cognitive-substrate\/[^"']+)["']|import\s+["'](@cognitive-substrate\/[^"']+)["'])/g;

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(importPattern)) {
      const packageName = match[1] ?? match[2];
      if (packageName) imports.add(packageName);
    }
  }

  return imports;
}

async function sourceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await sourceFiles(path));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      results.push(path);
    }
  }
  return results;
}

function collectTransitiveDeps(
  packageName: string,
  byName: Map<string | undefined, { readonly packageJson: PackageJson }>,
  target: Map<string, Set<string>>,
  source: string,
  seen: Set<string>,
): void {
  if (seen.has(packageName)) return;
  seen.add(packageName);
  const pkg = byName.get(packageName);
  if (!pkg) return;

  for (const dep of workspaceDependencyNames(pkg.packageJson)) {
    mapAdd(target, dep, source);
    collectTransitiveDeps(dep, byName, target, source, seen);
  }
}

function workspaceDependencyNames(pkg: PackageJson): string[] {
  return Object.entries(pkg.dependencies ?? {})
    .filter(([name, version]) => name.startsWith("@cognitive-substrate/") && version.startsWith("workspace:"))
    .map(([name]) => name);
}

function mapAdd(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

async function cleanup(): Promise<void> {
  cleaningUp = true;
  await stopServices();
  if (process.env["SMOKE_KEEP_INFRA"] === "true") return;
  await runCommand("infra-down", "docker", ["compose", "-f", "docker-compose.smoke.yml", "down", "-v"]).catch(
    (error: unknown) => {
      report.error = report.error
        ? `${report.error}; cleanup failed: ${errorMessage(error)}`
        : `cleanup failed: ${errorMessage(error)}`;
    },
  );
}

async function stopServices(): Promise<void> {
  for (const service of services) {
    if (service.exitCode === null && service.signal === null) {
      service.process.kill("SIGTERM");
    }
  }
  await sleep(5_000);
  for (const service of services) {
    if (service.exitCode === null && service.signal === null) {
      service.process.kill("SIGKILL");
    }
    service.stream.end();
  }
}

async function writeReports(): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportMarkdownPath, renderMarkdownReport());
  process.stdout.write(`[deep-smoke] report: ${relative(repoRoot, reportMarkdownPath)}\n`);
}

function renderMarkdownReport(): string {
  const lines: string[] = [];
  lines.push("# Deep Smoke Baseline Report", "");
  lines.push(`Status: ${report.status}`);
  lines.push(`Run ID: ${report.runId}`);
  lines.push(`Git SHA: ${report.gitSha ?? "unknown"}`);
  lines.push(`Started: ${report.startedAt}`);
  lines.push(`Finished: ${report.finishedAt ?? ""}`);
  lines.push(`Duration: ${report.durationMs ?? 0} ms`, "");

  if (report.error) {
    lines.push(`Error: ${report.error}`, "");
  }

  lines.push("## Phases", "");
  for (const phase of report.phases) {
    lines.push(`- ${phase.status}: ${phase.name} (${phase.durationMs} ms)`);
    if (phase.error) lines.push(`  - ${phase.error}`);
  }
  lines.push("");

  lines.push("## Assertions", "");
  for (const assertion of report.assertions) {
    lines.push(`- ${assertion.status}: ${assertion.name}, expected ${assertion.expected}, actual ${assertion.actual}`);
  }
  lines.push("");

  lines.push("## Metrics", "");
  for (const [name, value] of Object.entries(report.metrics).sort()) {
    lines.push(`- ${name}: ${value}`);
  }
  lines.push("");

  lines.push("## Package Coverage", "");
  for (const pkg of report.coverage) {
    const sources = pkg.runtimeSources.length > 0 ? `, sources: ${pkg.runtimeSources.join(", ")}` : "";
    lines.push(`- ${pkg.name} (${pkg.path}): ${pkg.evidence.join(", ")}${sources}`);
  }
  lines.push("");

  lines.push("## Service Logs", "");
  for (const service of report.services) {
    lines.push(`- ${service.name}: ${service.logPath}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function mergeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  for (const key of hostedEnvKeys) {
    delete env[key];
  }
  return env;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function parseEnvFile(contents: string | undefined): Record<string, string> {
  if (!contents) return {};
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

process.on("SIGINT", () => {
  process.stderr.write("[deep-smoke] interrupted\n");
  process.exitCode = 130;
  void cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  process.stderr.write("[deep-smoke] terminated\n");
  process.exitCode = 143;
  void cleanup().finally(() => process.exit(143));
});

main().catch((error: unknown) => {
  process.stderr.write(`[deep-smoke] fatal: ${errorMessage(error)}\n`);
  process.exit(1);
});
