import {
  CognitiveConsumer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  createTelemetryClientFromEnv,
  TelemetryInserter,
} from "@cognitive-substrate/clickhouse-telemetry";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import {
  trackRecommendation,
  recordOutcome,
  type RecommendationEvent,
  type OutcomeFeedback,
} from "./outcome-tracker.js";

const ENVIRONMENT = process.env["ENVIRONMENT"] ?? "prod";

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("reinforcement-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[reinforcement-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafka = createKafkaClient(kafkaConfigFromEnv());
  const openSearch = createOpenSearchClient(opensearchConfigFromEnv());
  const clickhouse = createTelemetryClientFromEnv();

  log("Ensuring ClickHouse tables exist...");
  await clickhouse.ensureTables();

  const inserter = new TelemetryInserter(clickhouse);
  const groupId = process.env["KAFKA_GROUP_ID"] ?? "reinforcement-workers";

  const consumer = new CognitiveConsumer({
    kafka,
    groupId,
  });
  await consumer.connect();

  // Subscribe to recommendations: track them on receipt
  log(`Subscribing to ${Topics.COGNITION_RECOMMENDATIONS}...`);
  await consumer.subscribe<RecommendationEvent>(
    [Topics.COGNITION_RECOMMENDATIONS],
    async (message) => {
      const rec = message.value;
      log(`Tracking recommendation ${rec.recommendationId} for pattern ${rec.patternId}`);
      await trackRecommendation(rec, inserter, ENVIRONMENT);
    },
  );

  // Subscribe to policy evaluations: use them as outcome signals
  // Policy evaluation events carry reward scores that proxy for whether the
  // system is improving after a recommendation was acted upon.
  const outcomeConsumer = new CognitiveConsumer({
    kafka,
    groupId: `${groupId}-outcomes`,
  });
  await outcomeConsumer.connect();

  log(`Subscribing to ${Topics.POLICY_EVALUATION} for outcome signals...`);
  await outcomeConsumer.subscribe<Record<string, unknown>>(
    [Topics.POLICY_EVALUATION],
    async (message) => {
      const evaluation = message.value;
      // Policy evaluations that reference a recommendation_id are treated as
      // outcome feedback for the referenced recommendation.
      const recommendationId = evaluation["recommendationId"] as string | undefined;
      const patternId = evaluation["patternId"] as string | undefined;
      if (!recommendationId || !patternId) return;

      const rewardScore = (evaluation["rewardScore"] as number | undefined) ?? 0.5;
      const outcome: OutcomeFeedback["outcome"] =
        rewardScore >= 0.7 ? "success"
        : rewardScore >= 0.4 ? "partial"
        : "failure";

      const latencyDeltaMs = evaluation["latencyDeltaMs"];
      const feedback: OutcomeFeedback = {
        recommendationId,
        patternId,
        actionTaken: (evaluation["actionTaken"] as string | undefined) ?? "unknown",
        outcome,
        ...(typeof latencyDeltaMs === "number" ? { latencyDeltaMs } : {}),
        confidenceBefore: rewardScore,
      };

      log(
        `Recording outcome for recommendation ${recommendationId}: ${outcome} (reward=${rewardScore.toFixed(3)})`,
      );
      await recordOutcome(feedback, inserter, openSearch, ENVIRONMENT);
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    await consumer.disconnect();
    await outcomeConsumer.disconnect();
    await clickhouse.close();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Listening for recommendations and policy evaluations...");
}
