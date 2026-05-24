import {
  CognitiveLoop,
  GoalSystem,
  InMemorySessionManager,
  KafkaGoalProgressPublisher,
  ClaudeReasoningModel,
  claudeAvailable,
  OpenAICompatReasoningModel,
  openAICompatAvailable,
  GeminiReasoningModel,
  geminiAvailable,
  MultiAgentReasoningModel,
  MultiAgentRuntime,
  OpenSearchAgentActivityStore,
  type GoalProvider,
  type ReasoningModel,
  type ToolExecutor,
  type ActionRequest,
} from "@cognitive-substrate/agents";
import type { Goal, ToolCapability } from "@cognitive-substrate/core-types";
import type { AgentContext, EventResult } from "@cognitive-substrate/core-types";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { Client } from "@opensearch-project/opensearch";
import type { QueryEmbeddingClient } from "@cognitive-substrate/retrieval-engine";
import { MemoryRetriever } from "@cognitive-substrate/retrieval-engine";
import { OpenSearchPolicyStore, PolicyEngine } from "@cognitive-substrate/policy-engine";
import { KafkaWorldModelPredictionPublisher, OpenSearchWorldModelStore, WorldModelEngine } from "@cognitive-substrate/world-model";
import { CompositeToolExecutor, mcpServersFromEnv } from "@cognitive-substrate/tool-executor";
import { KafkaPolicyEvaluationPublisher } from "./publishers.js";

export interface SocietyLoopConfig {
  readonly openSearchClient: Client;
  readonly producer: CognitiveProducer;
  readonly embedder: QueryEmbeddingClient;
  /** Plugin-supplied reasoning model. Takes priority over the built-in env chain when set. */
  readonly pluginReasoningModel?: ReasoningModel;
  /** Plugin-supplied tool executors, composed alongside the built-in CompositeToolExecutor. */
  readonly pluginToolExecutors?: ReadonlyArray<ToolExecutor>;
}

export async function createSocietyLoop(config: SocietyLoopConfig): Promise<CognitiveLoop> {
  const goalSystem = new GoalSystem({
    publisher: new KafkaGoalProgressPublisher(config.producer),
  });
  const worldModel = new WorldModelEngine({
    store: new OpenSearchWorldModelStore(config.openSearchClient),
    publisher: new KafkaWorldModelPredictionPublisher(config.producer),
  });
  void worldModel;

  const policyEngine = new PolicyEngine({
    store: new OpenSearchPolicyStore({ openSearch: config.openSearchClient }),
  });

  const memoryRetriever = new MemoryRetriever({
    openSearch: config.openSearchClient,
    embedder: config.embedder,
  });

  // Wire CompositeToolExecutor with MCP servers read from env.
  const mcpServers = mcpServersFromEnv();
  const baseToolExecutor = new CompositeToolExecutor({
    producer: config.producer,
    memoryRetriever,
    mcpServers,
  });
  await baseToolExecutor.connect(mcpServers);

  const toolExecutor: ToolExecutor =
    config.pluginToolExecutors && config.pluginToolExecutors.length > 0
      ? new PluginCompositeToolExecutor(baseToolExecutor, config.pluginToolExecutors)
      : baseToolExecutor;

  const reasoningModel: ReasoningModel = selectReasoningModel(config);

  return new CognitiveLoop({
    sessionManager: new InMemorySessionManager(),
    goalProvider: new GoalSystemProvider(goalSystem),
    policyProvider: policyEngine,
    memoryRetriever,
    reasoningModel,
    toolExecutor,
    policyEvaluationPublisher: new KafkaPolicyEvaluationPublisher(config.producer),
  });
}

/**
 * Select a reasoning model based on available env vars and CS_ENGINE_ORDER.
 *
 * CS_ENGINE_ORDER (comma-separated) controls priority among built-in providers.
 * Valid tokens: ollama, openai-compat, gemini, claude, multi-agent
 * Default order: ollama,openai-compat,gemini,claude,multi-agent
 *
 * Plugin model always wins when pluginReasoningModel is set.
 */
function selectReasoningModel(config: SocietyLoopConfig): ReasoningModel {
  if (config.pluginReasoningModel) return config.pluginReasoningModel;

  const order = (process.env["CS_ENGINE_ORDER"] ?? "ollama,openai-compat,gemini,claude,multi-agent")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const token of order) {
    switch (token) {
      case "ollama": {
        const ollamaURL = process.env["OLLAMA_BASE_URL"];
        if (ollamaURL)
          return new OpenAICompatReasoningModel({ baseURL: ollamaURL, apiKey: "ollama" });
        break;
      }
      case "openai-compat":
        if (openAICompatAvailable()) return new OpenAICompatReasoningModel();
        break;
      case "gemini":
        if (geminiAvailable()) return new GeminiReasoningModel();
        break;
      case "claude":
        if (claudeAvailable()) return new ClaudeReasoningModel();
        break;
      case "multi-agent":
        return buildMultiAgentModel(config.openSearchClient);
    }
  }

  return buildMultiAgentModel(config.openSearchClient);
}

function buildMultiAgentModel(openSearch: import("@opensearch-project/opensearch").Client): ReasoningModel {
  return new MultiAgentReasoningModel(
    new MultiAgentRuntime({
      activityStore: new OpenSearchAgentActivityStore({ openSearch }),
    }),
  );
}

class GoalSystemProvider implements GoalProvider {
  private readonly goalSystem: GoalSystem;

  constructor(goalSystem: GoalSystem) {
    this.goalSystem = goalSystem;
  }

  async listActiveGoals(): Promise<ReadonlyArray<Goal>> {
    return this.goalSystem.listActiveGoals();
  }
}

/**
 * Composes the built-in CompositeToolExecutor with zero or more plugin
 * executors. Plugin tools are tried first (by declared tool name); unknown
 * tool names fall through to the built-in executor.
 */
class PluginCompositeToolExecutor implements ToolExecutor {
  constructor(
    private readonly base: ToolExecutor,
    private readonly plugins: ReadonlyArray<ToolExecutor>,
  ) {}

  listTools(): ReadonlyArray<ToolCapability> {
    return [
      ...this.base.listTools(),
      ...this.plugins.flatMap((p) => p.listTools()),
    ];
  }

  async execute(action: ActionRequest, context: AgentContext): Promise<EventResult> {
    for (const plugin of this.plugins) {
      if (plugin.listTools().some((t) => t.tool === action.tool)) {
        return plugin.execute(action, context);
      }
    }
    return this.base.execute(action, context);
  }
}
