import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ignoredDirNames = new Set(["node_modules", "dist", ".next", ".git", "deploy"]);
const topicAllowlist = new Set([
  "AGENT_REASONING_REQUEST",
  "AGENT_REASONING_RESPONSE",
  "WORLDMODEL_PREDICTION",
  "POLICY_UPDATED",
  "GOAL_PROGRESS",
  "IDENTITY_UPDATED",
  "SELFMOD_PROPOSED",
  "SELFMOD_VALIDATED",
  "TELEMETRY_TRACES_RAW",
  "COGNITION_PATTERNS",
]);

const errors: string[] = [];

await checkWorkspaceDependencies();
await checkKafkaTopics();
await checkEnvExamples();

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  throw new Error(`${errors.length} workspace contract check(s) failed`);
}

process.stdout.write("[check-workspace-contracts] workspace contracts passed\n");

async function checkWorkspaceDependencies(): Promise<void> {
  for (const pkg of await workspacePackages()) {
    const deps = Object.keys(pkg.packageJson.dependencies ?? {})
      .filter((name) => name.startsWith("@cognitive-substrate/"));
    if (deps.length === 0) continue;

    const srcDir = join(repoRoot, pkg.path, "src");
    const imports = await sourceImports(srcDir);
    for (const dep of deps) {
      if (!imports.has(dep)) {
        errors.push(`${pkg.path}/package.json declares ${dep} but src/ does not import it`);
      }
    }
  }
}

async function checkKafkaTopics(): Promise<void> {
  const topicsSource = await readFile(join(repoRoot, "packages/kafka-bus/src/topics.ts"), "utf8");
  const topicNames = [...topicsSource.matchAll(/([A-Z0-9_]+):\s+"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((name) => !topicAllowlist.has(name));
  const sources = await allSourceContents();

  for (const topicName of topicNames) {
    const producerPattern = new RegExp(`\\.publish\\(\\s*Topics\\.${topicName}\\b`);
    const consumerPattern = new RegExp(`\\[([^\\]]*Topics\\.${topicName}[^\\]]*)\\]|subscribe<[^>]+>\\(\\s*\\[\\s*Topics\\.${topicName}\\b`, "m");
    const hasProducer = sources.some((source) => producerPattern.test(source.contents));
    const hasConsumer = sources.some((source) => consumerPattern.test(source.contents));
    if (!hasProducer) errors.push(`Kafka topic Topics.${topicName} has no producer call`);
    if (!hasConsumer) errors.push(`Kafka topic Topics.${topicName} has no consumer subscription`);
  }
}

async function checkEnvExamples(): Promise<void> {
  const files = (await walk(repoRoot))
    .filter((file) => file.endsWith(".env.example"))
    .filter((file) => !file.includes("/deploy/"));
  const sourceText = (await allSourceContents()).map((source) => source.contents).join("\n");
  const envReadPattern = /process\.env\[['"]([^'"]+)['"]\]/g;
  const readVars = new Set([...sourceText.matchAll(envReadPattern)].map((match) => match[1]!));

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const name of envNames(contents)) {
      if (!readVars.has(name) && !sourceText.includes(`"${name}"`) && !sourceText.includes(`'${name}'`)) {
        errors.push(`${relative(repoRoot, file)} documents ${name}, but no TypeScript source reads it`);
      }
    }
  }
}

async function workspacePackages(): Promise<Array<{ path: string; packageJson: PackageJson }>> {
  const roots = ["packages", "apps", "apps/workers"];
  const packages: Array<{ path: string; packageJson: PackageJson }> = [];
  for (const root of roots) {
    for (const path of await childPackageJsonPaths(join(repoRoot, root))) {
      packages.push({
        path: relative(repoRoot, dirname(path)),
        packageJson: JSON.parse(await readFile(path, "utf8")) as PackageJson,
      });
    }
  }
  return packages;
}

async function childPackageJsonPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(root, entry.name, "package.json");
    if (await isFile(packageJsonPath)) paths.push(packageJsonPath);
  }
  return paths;
}

async function sourceImports(root: string): Promise<Set<string>> {
  const imports = new Set<string>();
  for (const file of await walk(root)) {
    if (!file.endsWith(".ts")) continue;
    const contents = await readFile(file, "utf8");
    for (const match of contents.matchAll(/(?:from\s+["'](@cognitive-substrate\/[^"']+)["']|import\s+["'](@cognitive-substrate\/[^"']+)["'])/g)) {
      const dep = match[1] ?? match[2];
      if (dep) imports.add(dep);
    }
  }
  return imports;
}

async function allSourceContents(): Promise<Array<{ path: string; contents: string }>> {
  const roots = ["apps", "packages", "scripts"];
  const files = (await Promise.all(roots.map((root) => walk(join(repoRoot, root)))))
    .flat()
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.includes("/deploy/"));
  return Promise.all(files.map(async (path) => ({ path, contents: await readFile(path, "utf8") })));
}

async function walk(root: string): Promise<string[]> {
  if (!(await isDirectory(root))) return [];
  const results: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (ignoredDirNames.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walk(path));
    } else if (entry.isFile()) {
      results.push(path);
    }
  }
  return results;
}

function envNames(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false);
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isDirectory()).catch(() => false);
}
