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
import { OpenSearchMlClient } from "@cognitive-substrate/memory-opensearch";
import type { QueryEmbeddingClient, RerankClient } from "@cognitive-substrate/retrieval-engine";
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

export interface SocietyLoopBundle {
  readonly loop: CognitiveLoop;
  readonly policyEngine: PolicyEngine;
  readonly hasReranker: boolean;
  readonly reasoningModelName: string;
}

export async function createSocietyLoop(config: SocietyLoopConfig): Promise<SocietyLoopBundle> {
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

  const { reranker, hasReranker } = await resolveReranker(config.openSearchClient);
  const memoryRetriever = new MemoryRetriever({
    openSearch: config.openSearchClient,
    embedder: config.embedder,
    ...(reranker ? { reranker } : {}),
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

  const { model: reasoningModel, name: reasoningModelName } = selectReasoningModel(config);

  const loop = new CognitiveLoop({
    sessionManager: new InMemorySessionManager(),
    goalProvider: new GoalSystemProvider(goalSystem),
    policyProvider: policyEngine,
    memoryRetriever,
    reasoningModel,
    toolExecutor,
    policyEvaluationPublisher: new KafkaPolicyEvaluationPublisher(config.producer),
  });

  return { loop, policyEngine, hasReranker, reasoningModelName };
}

/**
 * Prefer a live LLM when credentials/URL are present; multi-agent stubs are
 * last resort for smoke/local without keys.
 *
 * CS_ENGINE_ORDER (comma-separated) controls priority among built-in providers.
 * Valid tokens: claude, ollama, openai-compat, gemini, multi-agent
 * Default order: claude,ollama,openai-compat,gemini,multi-agent
 *
 * Plugin model always wins when pluginReasoningModel is set.
 */
function selectReasoningModel(config: SocietyLoopConfig): {
  model: ReasoningModel;
  name: string;
} {
  if (config.pluginReasoningModel) {
    return { model: config.pluginReasoningModel, name: "plugin" };
  }

  const order = (
    process.env["CS_ENGINE_ORDER"] ?? "claude,ollama,openai-compat,gemini,multi-agent"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const token of order) {
    switch (token) {
      case "claude":
        if (claudeAvailable()) return { model: new ClaudeReasoningModel(), name: "claude" };
        break;
      case "ollama": {
        const ollamaURL = process.env["OLLAMA_BASE_URL"];
        if (ollamaURL)
          return {
            model: new OpenAICompatReasoningModel({ baseURL: ollamaURL, apiKey: "ollama" }),
            name: "ollama",
          };
        break;
      }
      case "openai-compat":
        if (openAICompatAvailable())
          return { model: new OpenAICompatReasoningModel(), name: "openai-compat" };
        break;
      case "gemini":
        if (geminiAvailable()) return { model: new GeminiReasoningModel(), name: "gemini" };
        break;
      case "multi-agent":
        return {
          model: buildMultiAgentModel(config.openSearchClient),
          name: "multi-agent",
        };
    }
  }

  return {
    model: buildMultiAgentModel(config.openSearchClient),
    name: "multi-agent",
  };
}

async function resolveReranker(
  openSearch: Client,
): Promise<{ reranker?: RerankClient; hasReranker: boolean }> {
  if (process.env["OPENSEARCH_RERANKER_DISABLED"] === "1") {
    return { hasReranker: false };
  }

  const envModelId = process.env["OPENSEARCH_RERANKER_MODEL_ID"];
  const modelId = envModelId ?? (await discoverDeployedReranker(openSearch));
  if (!modelId) return { hasReranker: false };

  const ml = new OpenSearchMlClient(openSearch);
  const reranker: RerankClient = {
    rerank: (query, candidates) => ml.rerank(modelId, query, candidates),
  };
  return { reranker, hasReranker: true };
}

async function discoverDeployedReranker(openSearch: Client): Promise<string | undefined> {
  try {
    const response = await openSearch.transport.request({
      method: "POST",
      path: "/_plugins/_ml/models/_search",
      body: { query: { term: { model_state: "DEPLOYED" } }, size: 20 },
    });
    const body = response.body as {
      hits: {
        hits: Array<{
          _id: string;
          _source: { name?: string; algorithm?: string };
        }>;
      };
    };
    const hit = body.hits.hits.find((h) => {
      if (/_\d+$/.test(h._id)) return false;
      const name = h._source.name ?? "";
      const algo = h._source.algorithm ?? "";
      return (
        algo === "TEXT_SIMILARITY" ||
        name.includes("cross-encoder") ||
        name.includes("cross-encoders") ||
        name.includes("reranker")
      );
    });
    return hit?._id;
  } catch {
    return undefined;
  }
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
