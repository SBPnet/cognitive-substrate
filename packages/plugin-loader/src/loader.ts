import type {
  CognitiveSubstratePlugin,
  EnginePlugin,
  IngestMapperPlugin,
  ToolExecutorPlugin,
} from "./types.js";

type ShutdownablePlugin = (EnginePlugin | ToolExecutorPlugin) & {
  shutdown(): Promise<void>;
};

export interface LoadedPlugins {
  readonly ingestMappers: ReadonlyArray<IngestMapperPlugin>;
  readonly engines: ReadonlyArray<EnginePlugin>;
  readonly toolExecutors: ReadonlyArray<ToolExecutorPlugin>;
}

/**
 * Reads `CS_PLUGINS` (comma-separated package names), dynamically imports
 * each, validates the exported `plugin` manifest, and returns bucketed lists.
 *
 * Fails loudly: any import failure, missing/invalid export, or unknown `kind`
 * throws immediately — broken plugins must never degrade silently.
 *
 * Uses bare package specifiers so pnpm workspace symlinks handle resolution.
 * Do NOT convert names to file paths; that defeats Node16 module resolution.
 */
export async function loadPluginsFromEnv(): Promise<LoadedPlugins> {
  const raw = process.env["CS_PLUGINS"];
  if (!raw?.trim()) {
    return { ingestMappers: [], engines: [], toolExecutors: [] };
  }

  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ingestMappers: IngestMapperPlugin[] = [];
  const engines: EnginePlugin[] = [];
  const toolExecutors: ToolExecutorPlugin[] = [];

  for (const name of names) {
    let mod: unknown;
    try {
      mod = await import(name);
    } catch (err) {
      throw new Error(
        `[plugin-loader] Failed to import plugin "${name}": ${(err as Error).message}`,
      );
    }

    const exported = (mod as Record<string, unknown>)["plugin"];
    if (exported === undefined || exported === null || typeof exported !== "object") {
      throw new Error(
        `[plugin-loader] Package "${name}" does not export a named "plugin" object. ` +
          `Every CS plugin must: export const plugin: CognitiveSubstratePlugin = { ... }`,
      );
    }

    const manifest = exported as CognitiveSubstratePlugin;

    switch (manifest.kind) {
      case "ingest-mapper":
        validateIngestMapper(manifest, name);
        ingestMappers.push(manifest);
        break;

      case "engine":
        validateEngine(manifest, name);
        engines.push(manifest);
        break;

      case "tool-executor":
        validateToolExecutor(manifest, name);
        toolExecutors.push(manifest);
        break;

      default: {
        const exhaustive: never = manifest;
        throw new Error(
          `[plugin-loader] Plugin "${name}" has unknown kind "${(exhaustive as { kind: string }).kind}"`,
        );
      }
    }

    process.stdout.write(
      `[plugin-loader] Loaded ${manifest.kind} plugin: ${name}\n`,
    );
  }

  return { ingestMappers, engines, toolExecutors };
}

/**
 * Call shutdown() on all plugins that implement it, in parallel.
 * Uses allSettled so one plugin's failure does not prevent others from closing.
 */
export async function shutdownPlugins(plugins: LoadedPlugins): Promise<void> {
  const candidates = [...plugins.engines, ...plugins.toolExecutors];
  const shutdownable = candidates.filter(
    (p): p is ShutdownablePlugin => typeof (p as unknown as Record<string, unknown>)["shutdown"] === "function",
  );
  await Promise.allSettled(shutdownable.map((p) => p.shutdown()));
}

function validateIngestMapper(p: IngestMapperPlugin, name: string): void {
  if (!Array.isArray(p.handles) || p.handles.length === 0) {
    throw new Error(
      `[plugin-loader] ingest-mapper plugin "${name}" must declare a non-empty "handles" array`,
    );
  }
  if (typeof p.map !== "function") {
    throw new Error(
      `[plugin-loader] ingest-mapper plugin "${name}" must export a "map" function`,
    );
  }
}

function validateEngine(p: EnginePlugin, name: string): void {
  if (!p.name || typeof p.name !== "string") {
    throw new Error(
      `[plugin-loader] engine plugin "${name}" must declare a non-empty "name" string`,
    );
  }
  if (typeof p.create !== "function") {
    throw new Error(
      `[plugin-loader] engine plugin "${name}" must export a "create" function`,
    );
  }
}

function validateToolExecutor(p: ToolExecutorPlugin, name: string): void {
  if (typeof p.create !== "function") {
    throw new Error(
      `[plugin-loader] tool-executor plugin "${name}" must export a "create" function`,
    );
  }
}
