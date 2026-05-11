/**
 * Unit tests for the ingestion pipeline.
 *
 * These tests use in-process stubs for all external dependencies
 * (embedding client, OpenSearch, object store, Kafka producer) so that
 * they run without any infrastructure.
 *
 * Multi-profile tests verify that:
 *   - each active lane writes to its own vector field
 *   - embedding_meta records the primary profile
 *   - partial failure in one profile does not drop the event
 *   - all profiles failing causes the event to be rejected
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import { Topics } from "@cognitive-substrate/kafka-bus";
import { processEvent, type PipelineConfig } from "../pipeline.js";
import { StubEmbeddingClient, type ProfiledEmbeddingClient } from "../embedder.js";
import { scoreImportance } from "../scorer.js";
import type { EmbeddingProfile } from "@cognitive-substrate/memory-opensearch";

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

function makeProfile(
  lane: EmbeddingProfile["lane"],
  vectorField: string,
  dim: number,
): EmbeddingProfile {
  return { id: `stub-${lane}`, name: `Stub ${lane}`, lane, dimension: dim, vectorField, provider: "stub" };
}

function makeProfiledEmbedder(
  lane: EmbeddingProfile["lane"],
  vectorField: string,
  dim: number,
): ProfiledEmbeddingClient {
  return { profile: makeProfile(lane, vectorField, dim), client: new StubEmbeddingClient(dim) };
}

function makeFailingProfiledEmbedder(
  lane: EmbeddingProfile["lane"],
  vectorField: string,
  dim: number,
): ProfiledEmbeddingClient {
  return {
    profile: makeProfile(lane, vectorField, dim),
    client: {
      dimension: dim,
      embed: async (_text: string): Promise<ReadonlyArray<number>> => {
        throw new Error(`Simulated embed failure for ${lane}`);
      },
    },
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
// Pipeline integration tests (stubbed dependencies, single embedder)
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

// ---------------------------------------------------------------------------
// Multi-profile pipeline tests
// ---------------------------------------------------------------------------

describe("processEvent — multi-profile (profiledEmbedders)", () => {
  let publishedMessages: Array<{ topic: string; payload: unknown }>;
  let indexedDocuments: Array<{ index: string; id: string; doc: Record<string, unknown> }>;
  let storedObjects: Array<{ key: string; value: unknown }>;
  let mockProducer: { publish: jest.MockedFunction<(topic: string, payload: unknown) => Promise<void>> };

  function makeMultiProfileConfig(profiledEmbedders: ProfiledEmbeddingClient[]): PipelineConfig {
    return {
      profiledEmbedders,
      openSearch: {} as Parameters<typeof processEvent>[1]["openSearch"],
      indexDocument: async (_client, index, id, doc) => {
        indexedDocuments.push({ index, id, doc: doc as Record<string, unknown> });
      },
      objectStore: {
        put: jest.fn(async (key: string, value: unknown) => { storedObjects.push({ key, value }); }),
      } as unknown as PipelineConfig["objectStore"],
      producer: mockProducer as unknown as PipelineConfig["producer"],
    };
  }

  beforeEach(() => {
    publishedMessages = [];
    indexedDocuments = [];
    storedObjects = [];
    mockProducer = {
      publish: jest.fn(async (topic: string, payload: unknown) => {
        publishedMessages.push({ topic, payload });
      }),
    };
  });

  it("writes a separate vector field for each active profile", async () => {
    const config = makeMultiProfileConfig([
      makeProfiledEmbedder("quality",   "embedding_qwen",  4),
      makeProfiledEmbedder("efficient", "embedding_nomic", 3),
    ]);
    await processEvent(makeEvent(), config);
    const doc = indexedDocuments[0]?.doc;
    expect(Array.isArray(doc!["embedding_qwen"])).toBe(true);
    expect((doc!["embedding_qwen"] as number[]).length).toBe(4);
    expect(Array.isArray(doc!["embedding_nomic"])).toBe(true);
    expect((doc!["embedding_nomic"] as number[]).length).toBe(3);
  });

  it("also writes the legacy embedding field pointing to the primary profile", async () => {
    const config = makeMultiProfileConfig([
      makeProfiledEmbedder("quality", "embedding_qwen", 4),
    ]);
    await processEvent(makeEvent(), config);
    const doc = indexedDocuments[0]?.doc;
    expect(Array.isArray(doc!["embedding"])).toBe(true);
    expect((doc!["embedding"] as number[]).length).toBe(4);
  });

  it("records embedding_meta with the primary profile id and lane", async () => {
    const config = makeMultiProfileConfig([
      makeProfiledEmbedder("quality",   "embedding_qwen",  4),
      makeProfiledEmbedder("efficient", "embedding_nomic", 3),
    ]);
    await processEvent(makeEvent(), config);
    const meta = indexedDocuments[0]?.doc["embedding_meta"] as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta["profile_id"]).toBe("stub-quality");
    expect(meta["lane"]).toBe("quality");
    expect(meta["dimension"]).toBe(4);
    expect(meta["profiles"]).toEqual([
      expect.objectContaining({ lane: "quality", vector_field: "embedding_qwen" }),
      expect.objectContaining({ lane: "efficient", vector_field: "embedding_nomic" }),
    ]);
  });

  it("returns an enriched payload with dimension from the primary profile", async () => {
    const config = makeMultiProfileConfig([
      makeProfiledEmbedder("quality",   "embedding_qwen",  8),
      makeProfiledEmbedder("efficient", "embedding_nomic", 5),
    ]);
    const result = await processEvent(makeEvent(), config);
    expect(result.embeddingDimension).toBe(8);
  });

  it("tolerates a failing secondary profile and indexes with the surviving primary", async () => {
    const config = makeMultiProfileConfig([
      makeProfiledEmbedder("quality",              "embedding_qwen",  4),
      makeFailingProfiledEmbedder("efficient", "embedding_nomic", 3),
    ]);
    const result = await processEvent(makeEvent(), config);
    expect(result.eventId).toBe("test-event-001");
    const doc = indexedDocuments[0]?.doc;
    expect(Array.isArray(doc!["embedding_qwen"])).toBe(true);
    expect(doc!["embedding_nomic"]).toBeUndefined();
  });

  it("throws when all profiles fail (no vector can be written)", async () => {
    const config = makeMultiProfileConfig([
      makeFailingProfiledEmbedder("quality",   "embedding_qwen",  4),
      makeFailingProfiledEmbedder("efficient", "embedding_nomic", 3),
    ]);
    await expect(processEvent(makeEvent(), config)).rejects.toThrow(/All embedding profiles failed/);
  });
});
