import type { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import type {
  TelemetryInserter,
  PatternOutcomeRow,
} from "@cognitive-substrate/clickhouse-telemetry";
import { scoreReinforcement } from "@cognitive-substrate/reinforcement-engine";

const OPERATIONAL_PATTERNS_INDEX = "operational_patterns";

/**
 * A recommendation event arriving on the cognition.recommendations topic.
 * Emitted by the pattern worker.
 */
export interface RecommendationEvent {
  recommendationId: string;
  patternId: string;
  matchScore: number;
  interventions: string[];
  outcome: string;
  timestamp: string;
}

/**
 * Outcome feedback from an operator or automated system.
 * Can arrive via the policy.evaluation topic or a future feedback API.
 */
export interface OutcomeFeedback {
  recommendationId: string;
  patternId: string;
  actionTaken: string;
  /** "success" | "partial" | "failure" | "ignored" */
  outcome: "success" | "partial" | "failure" | "ignored";
  /** Change in key latency metric (ms), negative = improvement */
  latencyDeltaMs?: number;
  confidenceBefore: number;
}

/**
 * Track a recommendation and write the initial row to ClickHouse.
 * Called when a cognition.recommendations message is received.
 */
export async function trackRecommendation(
  rec: RecommendationEvent,
  inserter: TelemetryInserter,
  environment: string,
): Promise<void> {
  const row: PatternOutcomeRow = {
    timestamp: new Date(rec.timestamp),
    pattern_id: rec.patternId,
    recommendation_id: rec.recommendationId,
    action_taken: "pending",
    outcome: "pending",
    latency_delta_ms: null,
    confidence_before: rec.matchScore,
    confidence_after: null,
    environment,
  };
  await inserter.insertPatternOutcomes([row]);
}

/**
 * Record an outcome and update the pattern's confidence score in OpenSearch.
 *
 * Confidence update uses a simple exponential moving average:
 *   new_confidence = α × outcome_signal + (1 − α) × old_confidence
 * where outcome_signal is 1.0 for success, 0.5 for partial, 0.0 for failure.
 */
export async function recordOutcome(
  feedback: OutcomeFeedback,
  inserter: TelemetryInserter,
  openSearch: OpenSearchClient,
  environment: string,
  alpha = 0.15,
): Promise<void> {
  const reinforcement = scoreReinforcement({
    importance: feedback.outcome === "ignored" ? 0.2 : 0.7,
    usageFrequency: 0.5,
    goalRelevance: feedback.outcome === "success" ? 0.8 : 0.4,
    novelty: 0.3,
    predictionAccuracy:
      feedback.outcome === "success" ? 1.0
      : feedback.outcome === "partial" ? 0.6
      : feedback.outcome === "failure" ? 0.1
      : 0.4,
    emotionalWeight: Math.min(1, Math.abs(feedback.latencyDeltaMs ?? 0) / 1_000),
    contradictionRisk: feedback.outcome === "failure" ? 0.6 : 0.1,
    policyAlignment: feedback.outcome === "success" ? 0.8 : 0.4,
  });

  const newConfidence =
    alpha * reinforcement.reinforcement + (1 - alpha) * feedback.confidenceBefore;
  const newConfidenceClamped = Math.max(0.1, Math.min(0.99, newConfidence));

  // Write outcome row to ClickHouse
  const row: PatternOutcomeRow = {
    timestamp: new Date(),
    pattern_id: feedback.patternId,
    recommendation_id: feedback.recommendationId,
    action_taken: feedback.actionTaken,
    outcome: feedback.outcome,
    latency_delta_ms: feedback.latencyDeltaMs ?? null,
    confidence_before: feedback.confidenceBefore,
    confidence_after: newConfidenceClamped,
    environment,
  };
  await inserter.insertPatternOutcomes([row]);

  // Update pattern confidence in OpenSearch
  await openSearch.update({
    index: OPERATIONAL_PATTERNS_INDEX,
    id: feedback.patternId,
    body: {
      script: {
        source: `
          ctx._source.confidence = params.confidence;
          ctx._source.successCount = (ctx._source.successCount == null ? 0 : ctx._source.successCount) + params.successInc;
          ctx._source.updatedAt = params.updatedAt;
        `,
        params: {
          confidence: newConfidenceClamped,
          successInc: feedback.outcome === "success" ? 1 : 0,
          updatedAt: new Date().toISOString(),
        },
      },
    },
    retry_on_conflict: 3,
  });
}
