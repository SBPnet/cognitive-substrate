/**
 * CI helper: registers the baseline schema versions from the main branch
 * into a running Schema Registry instance so that compatibility checks
 * have a version history to compare against.
 *
 * Usage (in CI after starting schema-registry):
 *   SCHEMA_REGISTRY_URL=http://localhost:8081 \
 *   SCHEMA_BASELINE_REF=origin/main \
 *   pnpm tsx scripts/smoke/register-baseline-schemas.ts
 *
 * When SCHEMA_BASELINE_REF is unset, schemas are read from the working tree
 * (useful for seeding a fresh registry on the first-ever PR).
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_URL = process.env["SCHEMA_REGISTRY_URL"] ?? "http://localhost:8081";
const BASELINE_REF = process.env["SCHEMA_BASELINE_REF"];
const SCHEMAS_DIR = join(import.meta.dirname, "../../packages/kafka-bus/schemas");

function subjectFromFilename(filename: string): string {
  // e.g. experience.raw.v1.avsc -> experience.raw-value
  const base = filename.replace(/\.v\d+\.avsc$/, "");
  return `${base}-value`;
}

function readSchema(filename: string): string | null {
  if (!BASELINE_REF) {
    return readFileSync(join(SCHEMAS_DIR, filename), "utf-8");
  }
  try {
    return execSync(
      `git show "${BASELINE_REF}:packages/kafka-bus/schemas/${filename}"`,
      { encoding: "utf-8" },
    );
  } catch {
    // File doesn't exist on baseline ref -- new schema, nothing to register
    return null;
  }
}

async function registerSchema(subject: string, schemaJson: string): Promise<void> {
  const url = new URL(`/subjects/${encodeURIComponent(subject)}/versions`, REGISTRY_URL);
  const body = JSON.stringify({ schema: schemaJson });

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.schemaregistry.v1+json",
      "Accept": "application/vnd.schemaregistry.v1+json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to register ${subject}: ${res.status} ${text}`);
  }

  const { id } = (await res.json()) as { id: number };
  console.log(`  registered ${subject} -> id=${id}`);
}

async function main(): Promise<void> {
  const files = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".avsc"));

  if (files.length === 0) {
    console.log("No .avsc files found — nothing to register.");
    return;
  }

  const ref = BASELINE_REF ?? "working tree";
  console.log(`Registering ${files.length} baseline schemas from ${ref}...`);

  for (const filename of files) {
    const schemaJson = readSchema(filename);
    if (!schemaJson) {
      console.log(`  ${filename}: not found on ${BASELINE_REF ?? "working tree"} -- skipping`);
      continue;
    }

    const subject = subjectFromFilename(filename);
    await registerSchema(subject, schemaJson.trim());
  }

  console.log("Baseline registration complete.");
}

await main();
