import { randomUUID } from "node:crypto";
import type { Client } from "@opensearch-project/opensearch";
import { Topics, type TopicName } from "@cognitive-substrate/kafka-bus";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import type {
  RetrievalFeedbackInput,
  RetrievalFeedbackRecord,
} from "./types.js";

export interface AuditPublisher {
  publish<T>(
    topic: TopicName,
    payload: T,
    options?: { readonly key?: string },
  ): Promise<void>;
}

export interface RetrievalFeedbackWriterConfig {
  readonly openSearch: Client;
  readonly auditPublisher?: AuditPublisher;
  readonly indexFeedback?: typeof indexDocument;
}

export class RetrievalFeedbackWriter {
  private readonly openSearch: Client;
  private readonly auditPublisher: AuditPublisher | undefined;
  private readonly indexFeedback: typeof indexDocument;

  constructor(config: RetrievalFeedbackWriterConfig) {
    this.openSearch = config.openSearch;
    this.auditPublisher = config.auditPublisher;
    this.indexFeedback = config.indexFeedback ?? indexDocument;
  }

  async record(input: RetrievalFeedbackInput): Promise<RetrievalFeedbackRecord> {
    const record: RetrievalFeedbackRecord = {
      feedbackId: input.feedbackId ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      querySummary: input.querySummary,
      retrievedMemoryId: input.retrievedMemoryId,
      usedInResponse: input.usedInResponse,
      helpfulnessScore: input.helpfulnessScore,
      hallucinationDetected: input.hallucinationDetected,
      futureWeightAdjustment: input.futureWeightAdjustment,
    };

    await this.indexFeedback(this.openSearch, "retrieval_feedback", record.feedbackId, {
      feedback_id: record.feedbackId,
      timestamp: record.timestamp,
      query_summary: record.querySummary,
      retrieved_memory_id: record.retrievedMemoryId,
      used_in_response: record.usedInResponse,
      helpfulness_score: record.helpfulnessScore,
      hallucination_detected: record.hallucinationDetected,
      future_weight_adjustment: record.futureWeightAdjustment,
    });

    await this.auditPublisher?.publish(
      Topics.AUDIT_EVENTS,
      {
        eventType: "retrieval.feedback",
        timestamp: record.timestamp,
        payload: record,
      },
      { key: record.feedbackId },
    );

    return record;
  }
}
