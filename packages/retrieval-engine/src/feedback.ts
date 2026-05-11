/**
 * Retrieval-feedback writer.
 *
 * Records whether a retrieved memory was actually used in the final
 * response, and emits the same record onto the audit topic so that the
 * reinforcement loop and offline analyses can replay the decision. The
 * feedback entry feeds the future-weight adjustment that the
 * reinforcement engine applies during decay scoring.
 */

import { randomUUID } from "node:crypto";
import type { Client } from "@opensearch-project/opensearch";
import { Topics, type TopicName } from "@cognitive-substrate/kafka-bus";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import type {
  RetrievalFeedbackInput,
  RetrievalFeedbackRecord,
} from "./types.js";

/**
 * Minimal publisher contract used to mirror feedback records onto the
 * audit topic. Defined locally so that this module does not depend on
 * the full `CognitiveProducer` import surface.
 */
export interface AuditPublisher {
  publish<T>(
    topic: TopicName,
    payload: T,
    options?: { readonly key?: string },
  ): Promise<void>;
}

export interface RetrievalFeedbackWriterConfig {
  readonly openSearch: Client;
  /** When provided, every feedback record is also mirrored to the audit topic. */
  readonly auditPublisher?: AuditPublisher;
  /** Override hook for tests; defaults to the production `indexDocument`. */
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

  /**
   * Persists one retrieval-feedback record to the `retrieval_feedback`
   * index, optionally mirroring it onto the audit topic, and returns
   * the record (with server-supplied `feedbackId` and `timestamp`
   * populated when missing).
   */
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
