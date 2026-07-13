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
import { loadPluginsFromEnv, shutdownPlugins } from "@cognitive-substrate/plugin-loader";
import { operationalRegistry } from "@cognitive-substrate/core-types";
import { ReflectionEngine, CalibrationMonitor } from "@cognitive-substrate/metacog-engine";
import { IntrospectionEngine } from "@cognitive-substrate/introspection-engine";
import { ConstitutionEngine } from "@cognitive-substrate/constitution-engine";
import { queryEmbedderFromEnv } from "./embedder.js";
import { createSocietyLoop } from "./society.js";
import { AgentActionPublisher } from "./publishers.js";
import { ProposalStore } from "./schema-evolution/proposal-store.js";

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
  const embedder = queryEmbedderFromEnv();

  log("Ensuring OpenSearch indexes exist...");
  await ensureIndexes(openSearchClient);

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: true });
  await producer.connect();

  log("Loading plugins...");
  const plugins = await loadPluginsFromEnv();

  const csEngineName = process.env["CS_ENGINE"];
  const matchedEngine = csEngineName
    ? plugins.engines.find((e) => e.name === csEngineName)
    : undefined;
  if (csEngineName !== undefined && matchedEngine === undefined) {
    throw new Error(
      `[orchestrator] CS_ENGINE="${csEngineName}" is set but no loaded engine plugin declares that name. ` +
        `Loaded engines: [${plugins.engines.map((e) => e.name).join(", ")}]`,
    );
  }

  const pluginToolExecutors = await Promise.all(
    plugins.toolExecutors.map((p) => p.create()),
  );

  const { loop, policyEngine, hasReranker, reasoningModelName } = await createSocietyLoop({
    openSearchClient,
    producer,
    embedder,
    ...(matchedEngine !== undefined && { pluginReasoningModel: matchedEngine.create() }),
    pluginToolExecutors,
  });
  log(`Reasoning model: ${reasoningModelName}; hasReranker=${hasReranker}`);
  const agentActionPublisher = new AgentActionPublisher(producer);
  const reflectionEngine = new ReflectionEngine();
  const calibrationMonitor = new CalibrationMonitor();
  const introspectionEngine = new IntrospectionEngine();
  const constitutionEngine = new ConstitutionEngine();
  const proposalStore = new ProposalStore(openSearchClient);
  let reflectionsThisSession = 0;

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
      // Only user_input events trigger a cognitive loop turn. All other event
      // types (agent_action, tool_result, system_event, etc.) feed the memory
      // and reinforcement pipeline downstream but must not re-enter the LLM.
      if (event.type !== "user_input") return;
      let result;
      try {
        result = await loop.process(event);
        log(
          `Processed event ${event.eventId}; action success=${result.actionResult.success}`,
        );

        // Closed-loop policy update (Exp 44 / Exp 54): persist drifted policy
        // after each turn so explorationFactor can recover post-incident.
        try {
          await policyEngine.applyEvaluation(result.policyEvaluation);
        } catch (policyErr: unknown) {
          log(
            `Policy applyEvaluation failed: ${policyErr instanceof Error ? policyErr.message : String(policyErr)}`,
          );
        }

        // Publish agent_action ExperienceEvent so LLM decisions feed back into
        // the reinforcement and consolidation pipeline (Gap 2).
        await agentActionPublisher.publish(event, result);

        // Introspection: detect coverage gaps and emit a proposal if salient.
        const reflectionResult = await reflectionEngine.reflect({
          loopResult: result,
          priorReflectionsInSession: reflectionsThisSession,
        });
        reflectionsThisSession++;

        const traceEntry = {
          operationId: event.eventId,
          operationType: event.type,
          confidence: result.agentResult.confidence,
          succeeded: result.actionResult.success,
          riskScore: result.agentResult.riskScore,
          ...(result.actionResult.latencyMs !== undefined && { latencyMs: result.actionResult.latencyMs }),
        };
        const calibrationReport = calibrationMonitor.evaluate([traceEntry]);

        const proposal = introspectionEngine.assess(
          calibrationReport,
          operationalRegistry.getRegisteredSources(),
          [],
        );

        if (proposal) {
          const stableIdentity = {
            identityId: 'orchestrator',
            timestamp: new Date().toISOString(),
            curiosity: 0.5,
            caution: 0.5,
            verbosity: 0.5,
            toolDependence: 0.5,
            explorationPreference: 0.5,
            stabilityScore: 0.8,
          };
          const assessment = constitutionEngine.assess({
            policy: result.context.policy,
            identity: stableIdentity,
            proposal,
          });
          if (assessment.approved) {
            await proposalStore.save(proposal);
            log(`IntrospectionEngine: proposal saved mutation_id=${proposal.mutationId} type=${proposal.mutationType}`);
          }
        }
        void reflectionResult;

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
    await Promise.allSettled([
      consumer.disconnect(),
      shutdownPlugins(plugins),
    ]);
    await producer.disconnect();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Orchestrator started. Waiting for experience events...");
}
