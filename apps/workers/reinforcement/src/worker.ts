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
  ReinforcementMetrics,
} from "@cognitive-substrate/telemetry-otel";
import {
  trackRecommendation,
  recordOutcome,
  type RecommendationEvent,
  type OutcomeFeedback,
} from "./outcome-tracker.js";
import {
  blogReinforcementIntervalMs,
  runBlogReinforcementPass,
} from "./blog-reinforcement.js";

const ENVIRONMENT = process.env["ENVIRONMENT"] ?? "prod";

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("reinforcement-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[reinforcement-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const workerMetrics = new ReinforcementMetrics();
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
      const done = workerMetrics.startMessage();
      log(`Tracking recommendation ${rec.recommendationId} for pattern ${rec.patternId}`);
      try {
        await trackRecommendation(rec, inserter, ENVIRONMENT);
        workerMetrics.recommendationsTracked.add(1);
        done();
      } catch (err) {
        done(err);
        throw err;
      }
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

      const done = workerMetrics.startMessage({ outcome });
      log(
        `Recording outcome for recommendation ${recommendationId}: ${outcome} (reward=${rewardScore.toFixed(3)})`,
      );
      try {
        await recordOutcome(feedback, inserter, openSearch, ENVIRONMENT);
        workerMetrics.outcomesRecorded.add(1, { outcome });
        workerMetrics.rewardScore.record(rewardScore, { outcome });
        done();
      } catch (err) {
        done(err);
        throw err;
      }
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

  const blogIntervalMs = blogReinforcementIntervalMs();
  log(`Scheduling blog reinforcement every ${(blogIntervalMs / 3_600_000).toFixed(1)}h`);
  const runBlogPass = (): void => {
    void runBlogReinforcementPass(openSearch, log).catch((err: unknown) => {
      log(`Blog reinforcement failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  // First pass shortly after startup so salience catches up without waiting a full interval.
  setTimeout(runBlogPass, 30_000);
  setInterval(runBlogPass, blogIntervalMs);

  log("Worker started. Listening for recommendations and policy evaluations...");
}
