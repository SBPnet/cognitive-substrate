import {
  CognitiveLoop,
  GoalSystem,
  InMemorySessionManager,
  KafkaGoalProgressPublisher,
  LocalToolExecutor,
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
import { KafkaPolicyEvaluationPublisher } from "./publishers.js";

export interface SocietyLoopConfig {
  readonly openSearchClient: Client;
  readonly producer: CognitiveProducer;
  readonly embedder: QueryEmbeddingClient;
}

export function createSocietyLoop(config: SocietyLoopConfig): CognitiveLoop {
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

  return new CognitiveLoop({
    sessionManager: new InMemorySessionManager(),
    goalProvider: new GoalSystemProvider(goalSystem),
    policyProvider: policyEngine,
    memoryRetriever: new MemoryRetriever({
      openSearch: config.openSearchClient,
      embedder: config.embedder,
    }),
    reasoningModel: new MultiAgentReasoningModel(
      new MultiAgentRuntime({
        activityStore: new OpenSearchAgentActivityStore({
          openSearch: config.openSearchClient,
        }),
      }),
    ),
    toolExecutor: new LocalToolExecutor(),
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
