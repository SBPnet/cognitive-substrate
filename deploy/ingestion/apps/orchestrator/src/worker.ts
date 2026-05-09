import type { ExperienceEvent, InteractionResponseEvent } from "@cognitive-substrate/core-types";
import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  ensureKafkaTopics,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import { ZeroEmbeddingClient, embeddingDimensionFromEnv } from "./embedder.js";
import { createSocietyLoop } from "./society.js";

export async function startOrchestrator(): Promise<void> {
  const shutdown = await initTelemetry(telemetryConfigFromEnv("orchestrator"));

  const log = (msg: string): void => {
    process.stdout.write(`[orchestrator] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafkaConfig = kafkaConfigFromEnv();
  log("Ensuring Kafka topics exist...");
  await ensureKafkaTopics(kafkaConfig);

  const kafka = createKafkaClient(kafkaConfig);
  const openSearchClient = createOpenSearchClient(opensearchConfigFromEnv());
  const embedder = new ZeroEmbeddingClient(embeddingDimensionFromEnv());

  log("Ensuring OpenSearch indexes exist...");
  await ensureIndexes(openSearchClient);

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: true });
  await producer.connect();

  const loop = createSocietyLoop({
    openSearchClient,
    producer,
    embedder,
  });

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "orchestrators",
  });
  await consumer.connect();

  log(`Subscribing to ${Topics.EXPERIENCE_RAW}...`);

  await consumer.subscribe<ExperienceEvent>(
    [Topics.EXPERIENCE_RAW],
    async (message) => {
      const event = message.value;
      let result;
      try {
        result = await loop.process(event);
        log(
          `Processed event ${event.eventId}; action success=${result.actionResult.success}`,
        );

        const response: InteractionResponseEvent = {
          eventId: event.eventId,
          sessionId: event.context.sessionId,
          traceId: result.session.traceId,
          timestamp: new Date().toISOString(),
          status: "complete",
          responseText: result.agentResult.proposal,
          confidence: result.agentResult.confidence,
          riskScore: result.agentResult.riskScore,
          retrievedMemories: result.context.memories,
          policySnapshot: result.context.policy,
          agentResult: result.agentResult,
          session: result.session,
        };

        await producer.publish(Topics.INTERACTION_RESPONSE, response, {
          key: event.context.sessionId,
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log(`Error processing event ${event.eventId}: ${errorMessage}`);

        const failedResponse: InteractionResponseEvent = {
          eventId: event.eventId,
          sessionId: event.context.sessionId,
          traceId: event.context.traceId ?? event.eventId,
          timestamp: new Date().toISOString(),
          status: "failed",
          responseText: "",
          confidence: 0,
          riskScore: 1,
          retrievedMemories: [],
          policySnapshot: {
            version: "unknown",
            timestamp: new Date().toISOString(),
            retrievalBias: 0.5,
            toolBias: 0.5,
            riskTolerance: 0.5,
            memoryTrust: 0.5,
            explorationFactor: 0.5,
            goalPersistence: 0.5,
            workingMemoryDecayRate: 0.5,
          },
          agentResult: {
            agentId: "cognitive-loop",
            agentType: "executor",
            traceId: event.context.traceId ?? event.eventId,
            timestamp: new Date().toISOString(),
            proposal: "",
            confidence: 0,
            riskScore: 1,
            retrievedMemories: [],
          },
          session: {
            sessionId: event.context.sessionId,
            traceId: event.context.traceId ?? event.eventId,
            activeGoals: [],
            policyState: {
              version: "unknown",
              timestamp: new Date().toISOString(),
              retrievalBias: 0.5,
              toolBias: 0.5,
              riskTolerance: 0.5,
              memoryTrust: 0.5,
              explorationFactor: 0.5,
              goalPersistence: 0.5,
              workingMemoryDecayRate: 0.5,
            },
            workingMemory: [],
            participatingAgents: [],
            createdAt: Date.now(),
          },
          errorMessage,
        };

        await producer.publish(Topics.INTERACTION_RESPONSE, failedResponse, {
          key: event.context.sessionId,
        });
      }
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await consumer.disconnect();
    await producer.disconnect();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Orchestrator started. Waiting for experience events...");
}
