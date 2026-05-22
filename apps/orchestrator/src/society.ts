import {
  CognitiveLoop,
  GoalSystem,
  InMemorySessionManager,
  KafkaGoalProgressPublisher,
  ClaudeReasoningModel,
  claudeAvailable,
  OpenAICompatReasoningModel,
  openAICompatAvailable,
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

  // Reasoning model priority (cost-ascending):
  //   0. Plugin reasoning model               — CS_ENGINE set and plugin loaded (explicit override)
  //   1. OpenAICompatReasoningModel (local) — OLLAMA_BASE_URL set (free, Ollama on same machine)
  //   2. OpenAICompatReasoningModel (cloud)  — OPENAI_BASE_URL set (xAI Grok, etc.; per-token cost)
  //   3. ClaudeReasoningModel                — ANTHROPIC_API_KEY set (per-token cost)
  //   4. MultiAgentReasoningModel            — heuristic fallback, no LLM (dev only)
  const ollamaBaseURL = process.env["OLLAMA_BASE_URL"];
  const reasoningModel: ReasoningModel = config.pluginReasoningModel
    ? config.pluginReasoningModel
    : ollamaBaseURL
      ? new OpenAICompatReasoningModel({ baseURL: ollamaBaseURL, apiKey: "ollama" })
      : openAICompatAvailable()
        ? new OpenAICompatReasoningModel()
        : claudeAvailable()
          ? new ClaudeReasoningModel()
          : new MultiAgentReasoningModel(
              new MultiAgentRuntime({
                activityStore: new OpenSearchAgentActivityStore({
                  openSearch: config.openSearchClient,
                }),
              }),
            );

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
