/**
 * Unit tests for the ingestion pipeline.
 *
 * These tests use in-process stubs for all external dependencies
 * (embedding client, OpenSearch, object store, Kafka producer) so that
 * they run without any infrastructure.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import { Topics } from "@cognitive-substrate/kafka-bus";
import { processEvent, type PipelineConfig } from "../pipeline.js";
import { StubEmbeddingClient } from "../embedder.js";
import { scoreImportance } from "../scorer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<ExperienceEvent> = {}): ExperienceEvent {
  return {
    eventId: "test-event-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "user_input",
    context: { sessionId: "session-001" },
    input: {
      text: "Design a memory consolidation system",
      embedding: [],
    },
    importanceScore: 0,
    tags: ["memory", "design"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scorer unit tests
// ---------------------------------------------------------------------------

describe("scoreImportance", () => {
  it("gives a higher score to tool_result events than user_input events", () => {
    const base = makeEvent();
    const toolResult = makeEvent({ type: "tool_result" });
    expect(scoreImportance(toolResult)).toBeGreaterThan(scoreImportance(base));
  });

  it("gives a higher score when an action block is present", () => {
    const withAction = makeEvent({ action: { tool: "opensearch_query" } });
    expect(scoreImportance(withAction)).toBeGreaterThan(scoreImportance(makeEvent()));
  });

  it("clamps the result to [0, 1]", () => {
    const score = scoreImportance(makeEvent());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration tests (stubbed dependencies)
// ---------------------------------------------------------------------------

describe("processEvent", () => {
  let config: PipelineConfig;
  let publishedMessages: Array<{ topic: string; payload: unknown }>;
  let indexedDocuments: Array<{ index: string; id: string; doc: unknown }>;
  let storedObjects: Array<{ key: string; value: unknown }>;

  beforeEach(() => {
    publishedMessages = [];
    indexedDocuments = [];
    storedObjects = [];

    const mockProducer = {
      publish: jest.fn(async (topic: string, payload: unknown) => {
        publishedMessages.push({ topic, payload });
      }),
    };

    const mockOpenSearch = {} as Parameters<typeof processEvent>[1]["openSearch"];
    const mockIndexDocument: NonNullable<PipelineConfig["indexDocument"]> = async (
      _client,
      index,
      id,
      doc,
    ) => {
      indexedDocuments.push({ index, id, doc });
    };

    config = {
      embedder: new StubEmbeddingClient(4),
      openSearch: mockOpenSearch,
      indexDocument: mockIndexDocument,
      objectStore: {
        put: jest.fn(async (key: string, value: unknown) => {
          storedObjects.push({ key, value });
        }),
        get: jest.fn(async () => undefined),
        exists: jest.fn(async () => false),
        list: jest.fn(async () => []),
      } as unknown as PipelineConfig["objectStore"],
      producer: mockProducer as unknown as PipelineConfig["producer"],
    };
  });

  it("returns an enriched payload with the event ID and a non-zero importance score", async () => {
    const event = makeEvent({ type: "tool_result", tags: ["retrieval"] });

    const result = await processEvent(event, config);

    expect(result.eventId).toBe("test-event-001");
    expect(result.importanceScore).toBeGreaterThan(0);
    expect(result.embeddingDimension).toBe(4);
  });

  it("writes to object storage with a deterministic key", async () => {
    await processEvent(makeEvent(), config);

    const stored = storedObjects[0];
    expect(stored).toBeDefined();
    expect(stored!.key).toMatch(/^events\/2026\/01\/01\/test-event-001\.json$/);
  });

  it("emits to experience.enriched and memory.indexed topics", async () => {
    await processEvent(makeEvent(), config);

    const topics = publishedMessages.map((m) => m.topic);
    expect(topics).toContain(Topics.EXPERIENCE_ENRICHED);
    expect(topics).toContain(Topics.MEMORY_INDEXED);
  });
});
