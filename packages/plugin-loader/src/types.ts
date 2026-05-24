import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { ReasoningModel, ToolExecutor } from "@cognitive-substrate/agents";
import type { Hono } from "hono";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";

/**
 * An ingest-mapper plugin handles raw events of one or more `event.type`
 * strings, converting them to ExperienceEvents for the memory pipeline.
 *
 * Return `null` from `map()` to silently drop an event (e.g. filtered out
 * by business logic). Throw to surface a hard failure.
 *
 * Optionally, a plugin may supply `createWebhookRouter` to contribute an HTTP
 * receiver that publishes raw events onto telemetry.logs.raw. The API server
 * mounts each plugin's router at `/api/webhooks/<handle>` automatically --
 * no changes to server.ts are needed for new integrations.
 */
export interface IngestMapperPlugin {
  readonly kind: "ingest-mapper";
  /** The `event.type` strings this plugin owns — must be globally unique across plugins. */
  readonly handles: ReadonlyArray<string>;
  map(event: unknown): ExperienceEvent | null;
  /** Optional: contribute a Hono router that receives external webhook events. */
  createWebhookRouter?(getProducer: () => CognitiveProducer | null): Hono;
}

/**
 * An engine plugin contributes a new ReasoningModel implementation.
 * Selected when `CS_ENGINE=<name>` matches `plugin.name`.
 */
export interface EnginePlugin {
  readonly kind: "engine";
  readonly name: string;
  create(): ReasoningModel;
  /** Optional: close connections opened by create() on process shutdown. */
  shutdown?(): Promise<void>;
}

/**
 * A tool-executor plugin contributes additional tools to the
 * CompositeToolExecutor. Each plugin's tools are routed by tool name prefix;
 * duplicate tool names across plugins will resolve to the first match.
 */
export interface ToolExecutorPlugin {
  readonly kind: "tool-executor";
  create(): ToolExecutor | Promise<ToolExecutor>;
  /** Optional: close connections opened by create() on process shutdown. */
  shutdown?(): Promise<void>;
}

export type CognitiveSubstratePlugin =
  | IngestMapperPlugin
  | EnginePlugin
  | ToolExecutorPlugin;

/**
 * An API router plugin contributes one or more Hono routers to the API server.
 * Used by integration packages to mount control-plane routes and provider
 * webhooks without modifying core server code.
 *
 * Each plugin is mounted at the path returned by mountPath.
 * Register via the apiRouterPlugins parameter of createApp().
 */
export interface ApiRouterPlugin {
  /** Absolute mount path, e.g. "/api/aiven/collector". */
  readonly mountPath: string;
  createRouter(getProducer: () => CognitiveProducer | null): Hono;
}
