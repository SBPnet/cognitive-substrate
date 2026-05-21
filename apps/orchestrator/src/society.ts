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
} from "@cognitive-substrate/agents";
import type { Goal } from "@cognitive-substrate/core-types";
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
  const toolExecutor = new CompositeToolExecutor({
    producer: config.producer,
    memoryRetriever,
    mcpServers,
  });
  await toolExecutor.connect(mcpServers);

  // Reasoning model priority (cost-ascending):
  //   1. OpenAICompatReasoningModel (local) — OLLAMA_BASE_URL set (free, Ollama on same machine)
  //   2. OpenAICompatReasoningModel (cloud)  — OPENAI_BASE_URL set (xAI Grok, etc.; per-token cost)
  //   3. ClaudeReasoningModel                — ANTHROPIC_API_KEY set (per-token cost)
  //   4. MultiAgentReasoningModel            — heuristic fallback, no LLM (dev only)
  const ollamaBaseURL = process.env["OLLAMA_BASE_URL"];
  const reasoningModel = ollamaBaseURL
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
