import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageJson {
  readonly name?: string;
  readonly main?: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const packagesRoot = join(repoRoot, "packages");

const log = (msg: string): void => {
  process.stdout.write(`[package-baseline] ${msg}\n`);
};

const fail = (msg: string): never => {
  process.stderr.write(`[package-baseline] ERROR: ${msg}\n`);
  process.exit(1);
};

async function packageDirs(): Promise<string[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readPackageJson(packageDir: string): Promise<PackageJson> {
  const raw = await readFile(join(packagesRoot, packageDir, "package.json"), "utf8");
  return JSON.parse(raw) as PackageJson;
}

async function assertImportable(packageDir: string): Promise<string> {
  const pkg = await readPackageJson(packageDir);
  const name = pkg.name ?? packageDir;
  const main = pkg.main ?? "./dist/index.js";
  const entrypoint = join(packagesRoot, packageDir, main);

  try {
    await access(entrypoint);
  } catch {
    fail(`${name} has no built entrypoint at ${entrypoint}. Run pnpm -r build first.`);
  }

  await import(pathToFileURL(entrypoint).href);
  return name;
}

async function run(): Promise<void> {
  const dirs = await packageDirs();
  if (dirs.length === 0) fail("No packages found under packages/.");

  log(`Importing ${dirs.length} built package entrypoints...`);

  const imported: string[] = [];
  for (const dir of dirs) {
    const name = await assertImportable(dir);
    imported.push(name);
    log(`ok ${name}`);
  }

  log(`All ${imported.length} packages built and imported successfully.`);
}

run().catch((error: unknown) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
