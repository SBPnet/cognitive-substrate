import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { ReasoningModel, ToolExecutor } from "@cognitive-substrate/agents";

/**
 * An ingest-mapper plugin handles raw events of one or more `event.type`
 * strings, converting them to ExperienceEvents for the memory pipeline.
 *
 * Return `null` from `map()` to silently drop an event (e.g. filtered out
 * by business logic). Throw to surface a hard failure.
 */
export interface IngestMapperPlugin {
  readonly kind: "ingest-mapper";
  /** The `event.type` strings this plugin owns — must be globally unique across plugins. */
  readonly handles: ReadonlyArray<string>;
  map(event: unknown): ExperienceEvent | null;
}

/**
 * An engine plugin contributes a new ReasoningModel implementation.
 * Selected when `CS_ENGINE=<name>` matches `plugin.name`.
 */
export interface EnginePlugin {
  readonly kind: "engine";
  readonly name: string;
  create(): ReasoningModel;
}

/**
 * A tool-executor plugin contributes additional tools to the
 * CompositeToolExecutor. Each plugin's tools are routed by tool name prefix;
 * duplicate tool names across plugins will resolve to the first match.
 */
export interface ToolExecutorPlugin {
  readonly kind: "tool-executor";
  create(): ToolExecutor | Promise<ToolExecutor>;
}

export type CognitiveSubstratePlugin =
  | IngestMapperPlugin
  | EnginePlugin
  | ToolExecutorPlugin;
