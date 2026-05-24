#!/usr/bin/env node
/**
 * Scaffold a new cognitive-substrate plugin package.
 * Usage: node dist/cli.js <package-name> <kind>
 *   kind: ingest-mapper | engine | tool-executor
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KINDS = ["ingest-mapper", "engine", "tool-executor"] as const;
type Kind = (typeof KINDS)[number];

function usage(): never {
  process.stderr.write(
    `Usage: node dist/cli.js <package-name> <kind>\n` +
      `  kind: ${KINDS.join(" | ")}\n` +
      `Example: node dist/cli.js plugin-github ingest-mapper\n`,
  );
  return process.exit(1);
}

const rawPackageName = process.argv[2];
const rawKind = process.argv[3];

if (!rawPackageName || !rawKind || !KINDS.includes(rawKind as Kind)) usage();

const packageName: string = rawPackageName;
const kind: Kind = rawKind as Kind;

const dir = join(process.cwd(), "packages", packageName);
const srcDir = join(dir, "src");

async function scaffold(): Promise<void> {
  await mkdir(srcDir, { recursive: true });

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `@cognitive-substrate/${packageName}`,
        version: "0.1.0",
        type: "module",
        exports: {
          ".": {
            import: "./dist/index.js",
            types: "./dist/index.d.ts",
          },
        },
        scripts: { build: "tsc", clean: "rm -rf dist" },
        dependencies: {
          "@cognitive-substrate/core-types": "workspace:*",
          "@cognitive-substrate/plugin-loader": "workspace:*",
          ...(kind === "engine" || kind === "tool-executor"
            ? { "@cognitive-substrate/agents": "workspace:*" }
            : {}),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          typescript: "^5.5.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: { rootDir: "src", outDir: "dist", tsBuildInfoFile: "dist/.tsbuildinfo" },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(join(srcDir, "index.ts"), indexTemplate(kind as Kind, packageName));

  process.stdout.write(
    `[create-plugin] Scaffolded ${kind} plugin at packages/${packageName}/\n` +
      `\nNext steps:\n` +
      `  1. pnpm install\n` +
      `  2. pnpm --filter @cognitive-substrate/${packageName} build\n` +
      `  3. Add "@cognitive-substrate/${packageName}" to CS_PLUGINS\n` +
      `  4. Implement the plugin logic in packages/${packageName}/src/index.ts\n`,
  );
}

// ---------------------------------------------------------------------------
// Kind-specific templates
// ---------------------------------------------------------------------------

function indexTemplate(k: Kind, name: string): string {
  const eventType = name.replace(/^plugin-/, "") + "_event";
  const pascal = toPascal(name);

  if (k === "ingest-mapper") {
    return [
      `import { randomUUID } from "node:crypto";`,
      `import type { ExperienceEvent } from "@cognitive-substrate/core-types";`,
      `import type { IngestMapperPlugin } from "@cognitive-substrate/plugin-loader";`,
      ``,
      `export const plugin: IngestMapperPlugin = {`,
      `  kind: "ingest-mapper",`,
      `  // Raw event types this plugin claims — must be globally unique across plugins.`,
      `  handles: ["${eventType}"],`,
      ``,
      `  map(event: unknown): ExperienceEvent | null {`,
      `    // TODO: validate and transform the raw event`,
      `    const raw = event as Record<string, unknown>;`,
      `    return {`,
      `      eventId: randomUUID(),`,
      `      timestamp: new Date().toISOString(),`,
      `      // Map to the nearest built-in EventType. See core-types for the full list.`,
      `      type: "environmental_observation",`,
      `      context: { sessionId: String(raw["sessionId"] ?? "unknown"), agentId: "${name}" },`,
      `      input: { text: JSON.stringify(raw), embedding: [] },`,
      `      importanceScore: 0.5,`,
      `      tags: ["source:${name}", "event:${eventType}"],`,
      `    };`,
      `  },`,
      `};`,
      ``,
    ].join("\n");
  }

  if (k === "engine") {
    return [
      `import type { ReasoningModel } from "@cognitive-substrate/agents";`,
      `import type { EnginePlugin } from "@cognitive-substrate/plugin-loader";`,
      ``,
      `export const plugin: EnginePlugin = {`,
      `  kind: "engine",`,
      `  name: "${name}",`,
      ``,
      `  create(): ReasoningModel {`,
      `    // TODO: return your custom ReasoningModel implementation`,
      `    throw new Error("${name}: implement create()");`,
      `  },`,
      `};`,
      ``,
    ].join("\n");
  }

  // tool-executor
  return [
    `import type { AgentContext, EventResult, ToolCapability } from "@cognitive-substrate/core-types";`,
    `import type { ActionRequest, ToolExecutor } from "@cognitive-substrate/agents";`,
    `import type { ToolExecutorPlugin } from "@cognitive-substrate/plugin-loader";`,
    ``,
    `class ${pascal}ToolExecutor implements ToolExecutor {`,
    `  listTools(): ReadonlyArray<ToolCapability> {`,
    `    return [`,
    `      {`,
    `        tool: "${name}:example_tool",`,
    `        description: "An example tool contributed by ${name}",`,
    `        parameters: [`,
    `          { name: "input", type: "string", required: true, description: "Input string" },`,
    `        ],`,
    `      },`,
    `    ];`,
    `  }`,
    ``,
    `  async execute(action: ActionRequest, _context: AgentContext): Promise<EventResult> {`,
    `    if (action.tool === "${name}:example_tool") {`,
    `      return { output: \`echo: \${String(action.parameters?.["input"] ?? "")}\`, success: true };`,
    `    }`,
    `    return { output: \`Unknown tool: \${action.tool}\`, success: false };`,
    `  }`,
    `}`,
    ``,
    `export const plugin: ToolExecutorPlugin = {`,
    `  kind: "tool-executor",`,
    `  create(): ToolExecutor {`,
    `    return new ${pascal}ToolExecutor();`,
    `  },`,
    `};`,
    ``,
  ].join("\n");
}

function toPascal(s: string): string {
  return s
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

await scaffold();
