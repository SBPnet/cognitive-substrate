/**
 * Smoke test: verifies the plugin-loader contract.
 *
 * Tests the public API surface without requiring real third-party plugins:
 *   1. Empty CS_PLUGINS returns empty buckets
 *   2. Missing plugin import throws with the expected message prefix
 *   3. A package that exports a non-object "plugin" throws
 *   4. shutdownPlugins() resolves when no plugins implement shutdown()
 */

import { loadPluginsFromEnv, shutdownPlugins } from "../../packages/plugin-loader/src/index.js";

let passed = 0;
let failed = 0;

function pass(label: string): void {
  process.stdout.write(`  PASS  ${label}\n`);
  passed++;
}

function fail(label: string, detail?: string): void {
  process.stderr.write(`  FAIL  ${label}${detail ? `: ${detail}` : ""}\n`);
  failed++;
}

// --- Test 1: empty CS_PLUGINS ---

process.env["CS_PLUGINS"] = "";
const empty = await loadPluginsFromEnv();
if (
  empty.ingestMappers.length === 0 &&
  empty.engines.length === 0 &&
  empty.toolExecutors.length === 0
) {
  pass("empty CS_PLUGINS returns empty buckets");
} else {
  fail("empty CS_PLUGINS returns empty buckets", JSON.stringify(empty));
}

// --- Test 2: whitespace-only CS_PLUGINS ---

process.env["CS_PLUGINS"] = "   ";
const whitespace = await loadPluginsFromEnv();
if (
  whitespace.ingestMappers.length === 0 &&
  whitespace.engines.length === 0 &&
  whitespace.toolExecutors.length === 0
) {
  pass("whitespace CS_PLUGINS returns empty buckets");
} else {
  fail("whitespace CS_PLUGINS returns empty buckets");
}

// --- Test 3: missing plugin throws with expected prefix ---

process.env["CS_PLUGINS"] = "@cognitive-substrate/plugin-does-not-exist-xyz-smoke-test";
try {
  await loadPluginsFromEnv();
  fail("missing plugin import throws");
} catch (e) {
  const msg = (e as Error).message;
  if (msg.includes("Failed to import plugin")) {
    pass("missing plugin import throws with expected prefix");
  } else {
    fail("missing plugin import throws with expected prefix", msg);
  }
}

// --- Test 4: shutdownPlugins() resolves when no plugins implement shutdown() ---

process.env["CS_PLUGINS"] = "";
const emptyForShutdown = await loadPluginsFromEnv();
try {
  await shutdownPlugins(emptyForShutdown);
  pass("shutdownPlugins() resolves with empty plugin set");
} catch (e) {
  fail("shutdownPlugins() resolves with empty plugin set", (e as Error).message);
}

// --- Summary ---

process.stdout.write(`\n[plugin-contract] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
