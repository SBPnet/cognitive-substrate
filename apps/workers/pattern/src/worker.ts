import { randomUUID } from "crypto";
import {
  CognitiveConsumer,
  CognitiveProducer,
  Topics,
  createKafkaClient,
  kafkaConfigFromEnv,
} from "@cognitive-substrate/kafka-bus";
import {
  createOpenSearchClient,
  ensureIndexes,
  opensearchConfigFromEnv,
} from "@cognitive-substrate/memory-opensearch";
import {
  createTelemetryClientFromEnv,
  TelemetryInserter,
  type CognitiveEventRow,
} from "@cognitive-substrate/clickhouse-telemetry";
import {
  initTelemetry,
  telemetryConfigFromEnv,
} from "@cognitive-substrate/telemetry-otel";
import type { OperationalPrimitiveEvent } from "@cognitive-substrate/abstraction-engine";
import {
  PrimitiveWindow,
  matchPatterns,
  loadPatterns,
  upsertPattern,
  seedBuiltinPatternsIfEmpty,
  CONFIDENCE_THRESHOLD,
} from "./detector.js";

const PATTERN_RELOAD_INTERVAL_MS = 5 * 60 * 1000;

export async function startWorker(): Promise<void> {
  const shutdown = await initTelemetry(
    telemetryConfigFromEnv("pattern-worker"),
  );

  const log = (msg: string): void => {
    process.stdout.write(`[pattern-worker] ${new Date().toISOString()} ${msg}\n`);
  };

  const kafka = createKafkaClient(kafkaConfigFromEnv());
  const openSearch = createOpenSearchClient(opensearchConfigFromEnv());
  const clickhouse = createTelemetryClientFromEnv();

  log("Ensuring OpenSearch indexes and ClickHouse tables exist...");
  await ensureIndexes(openSearch);
  await clickhouse.ensureTables();

  const producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  const consumer = new CognitiveConsumer({
    kafka,
    groupId: process.env["KAFKA_GROUP_ID"] ?? "pattern-workers",
  });
  await consumer.connect();

  log("Loading pattern library from OpenSearch...");
  const seededPatterns = await seedBuiltinPatternsIfEmpty(openSearch);
  if (seededPatterns > 0) {
    log(`Seeded ${seededPatterns} built-in patterns into OpenSearch.`);
  }
  let patterns = await loadPatterns(openSearch);
  log(`Loaded ${patterns.length} operational patterns.`);

  // Reload patterns periodically so the worker picks up updates from the
  // reinforcement worker without restarting.
  const reloadInterval = setInterval(async () => {
    patterns = await loadPatterns(openSearch);
    log(`Reloaded ${patterns.length} patterns.`);
  }, PATTERN_RELOAD_INTERVAL_MS);

  const window = new PrimitiveWindow();
  const inserter = new TelemetryInserter(clickhouse);

  log(`Subscribing to ${Topics.COGNITION_PRIMITIVES}...`);

  await consumer.subscribe<OperationalPrimitiveEvent>(
    [Topics.COGNITION_PRIMITIVES],
    async (message) => {
      const event = message.value;
      window.push({
        ...event,
        timestamp: new Date(event.timestamp),
      });

      // Write to ClickHouse cognitive_events
      const cogRow: CognitiveEventRow = {
        timestamp: new Date(event.timestamp),
        primitive_id: event.primitiveId,
        intensity: event.intensity,
        trend: event.trend,
        scope: event.scope,
        confidence: event.confidence,
        source_system: event.sourceSystem,
        source_system_type: event.sourceSystemType,
        correlated_signal_ids: event.correlatedSignalIds,
        pattern_match_id: null,
        environment: process.env["ENVIRONMENT"] ?? "prod",
      };
      await inserter.insertCognitiveEvents([cogRow]);

      // Match against pattern library
      const matches = matchPatterns(window, patterns);

      for (const match of matches) {
        const { pattern, matchScore } = match;

        if (matchScore < CONFIDENCE_THRESHOLD) continue;

        const recommendationId = randomUUID();
        const anomalyPayload = {
          anomalyId: randomUUID(),
          patternId: pattern.patternId,
          matchScore,
          outcome: pattern.outcome,
          activePrimitives: Array.from(window.activePrimitives),
          timestamp: new Date().toISOString(),
        };

        const recommendationPayload = {
          recommendationId,
          patternId: pattern.patternId,
          matchScore,
          interventions: pattern.interventions,
          outcome: pattern.outcome,
          timestamp: new Date().toISOString(),
        };

        await producer.publish(Topics.COGNITION_ANOMALIES, anomalyPayload);
        await producer.publish(Topics.COGNITION_RECOMMENDATIONS, recommendationPayload);

        log(
          `Pattern matched: ${pattern.patternId} (score=${matchScore.toFixed(3)})`,
        );

        // Update observation count on the matched pattern
        await upsertPattern(openSearch, {
          ...pattern,
          observationCount: pattern.observationCount + 1,
          updatedAt: new Date(),
        });
      }
    },
  );

  const handleShutdown = async (): Promise<void> => {
    log("Shutting down...");
    clearInterval(reloadInterval);
    await consumer.disconnect();
    await producer.disconnect();
    await clickhouse.close();
    await shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  log("Worker started. Waiting for primitive events...");
}
