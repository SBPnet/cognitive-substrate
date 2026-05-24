/**
 * CI helper: validates that every .avsc file in the working tree is compatible
 * with its latest registered version in the Schema Registry.
 *
 * Exits non-zero if any schema is incompatible, so the CI build fails before
 * a breaking change can reach production.
 *
 * Usage (after register-baseline-schemas.ts has run):
 *   SCHEMA_REGISTRY_URL=http://localhost:8081 \
 *   pnpm tsx scripts/smoke/check-schema-compat.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_URL = process.env["SCHEMA_REGISTRY_URL"] ?? "http://localhost:8081";
const SCHEMAS_DIR = join(import.meta.dirname, "../../packages/kafka-bus/schemas");

function subjectFromFilename(filename: string): string {
  const base = filename.replace(/\.v\d+\.avsc$/, "");
  return `${base}-value`;
}

async function checkCompatibility(subject: string, schemaJson: string): Promise<boolean> {
  const url = new URL(
    `/compatibility/subjects/${encodeURIComponent(subject)}/versions/latest`,
    REGISTRY_URL,
  );
  const body = JSON.stringify({ schema: schemaJson });

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.schemaregistry.v1+json",
      "Accept": "application/vnd.schemaregistry.v1+json",
    },
    body,
  });

  // 404 = no versions registered yet (new subject on this PR) -- treat as compatible
  if (res.status === 404) return true;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Compatibility check failed for ${subject}: ${res.status} ${text}`);
  }

  const { is_compatible } = (await res.json()) as { is_compatible: boolean };
  return is_compatible;
}

async function main(): Promise<void> {
  const files = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".avsc"));

  if (files.length === 0) {
    console.log("No .avsc files found -- nothing to check.");
    process.exit(0);
  }

  console.log(`Checking compatibility for ${files.length} schemas against ${REGISTRY_URL}...`);

  const failures: string[] = [];

  for (const filename of files) {
    const schemaJson = readFileSync(join(SCHEMAS_DIR, filename), "utf-8").trim();
    const subject = subjectFromFilename(filename);

    const compatible = await checkCompatibility(subject, schemaJson);
    const status = compatible ? "PASS" : "FAIL";
    console.log(`  ${status}  ${subject}`);

    if (!compatible) failures.push(subject);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} incompatible schema(s):`);
    for (const s of failures) console.error(`  - ${s}`);
    console.error(
      "\nFix: ensure schema changes are backward-compatible (add optional fields, do not remove or rename required fields).",
    );
    process.exit(1);
  }

  console.log("\nAll schemas are compatible.");
}

await main();
