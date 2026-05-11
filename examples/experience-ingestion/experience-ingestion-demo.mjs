import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outputDir = join(here, "out");

const Topics = {
  EXPERIENCE_ENRICHED: "experience.enriched",
  MEMORY_INDEXED: "memory.indexed",
};

const representationMap = [
  {
    concept: "ExperienceEvent contract",
    demo: "A literal rawEvent object with context, input, state, action, result, evaluation, score, and tags.",
    production: "@cognitive-substrate/core-types ExperienceEvent.",
  },
  {
    concept: "Embedding",
    demo: "A deterministic eight-dimensional vector derived from text characters.",
    production: "EmbeddingClient, usually backed by an OpenAI-compatible endpoint or a stub in tests.",
  },
  {
    concept: "Importance scoring",
    demo: "The same four-signal heuristic: event type, tags, action presence, and result success.",
    production: "apps/workers/ingestion/src/scorer.ts.",
  },
  {
    concept: "Object-storage key",
    demo: "The same events/YYYY/MM/DD/eventId.json key format.",
    production: "packages/memory-objectstore/src/keys.ts.",
  },
  {
    concept: "Truth layer",
    demo: "A JSON file under examples/experience-ingestion/out/object-store/.",
    production: "S3-compatible object storage through EpisodicObjectStore.",
  },
  {
    concept: "Associative index",
    demo: "A JSON file under examples/experience-ingestion/out/opensearch/experience_events/.",
    production: "OpenSearch experience_events document.",
  },
  {
    concept: "Downstream signals",
    demo: "JSON payloads named experience.enriched and memory.indexed.",
    production: "Kafka messages published to the same topic names.",
  },
];

function eventKey(eventId, timestamp) {
  const date = new Date(timestamp);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `events/${yyyy}/${mm}/${dd}/${eventId}.json`;
}

function stubEmbedding(text, dimension = 8) {
  const seed = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: dimension }, (_, index) => {
    const value = ((seed + index * 17) % 100) / 100;
    return Number(value.toFixed(2));
  });
}

function scoreImportance(event) {
  const nonRoutineType = event.type !== "user_input" && event.type !== "system_event" ? 1 : 0.3;
  const hasTags = event.tags.length > 0 ? 1 : 0;
  const hasAction = event.action ? 1 : 0;
  const success = event.result?.success === true ? 1 : event.result?.success === false ? 0.1 : 0.5;
  const score = nonRoutineType * 0.3 + hasTags * 0.2 + hasAction * 0.2 + success * 0.3;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function processEvent(rawEvent) {
  const trace = [];

  trace.push({
    stage: "receive_raw_experience",
    concept: "The pipeline starts from a structured event, not an untyped log line.",
    mirrorsProduction: "ExperienceEvent is the unit consumed by the ingestion worker.",
    fields: Object.keys(rawEvent),
  });

  const embedding = stubEmbedding(rawEvent.input.text);
  trace.push({
    stage: "embed_input",
    concept: "Text is converted into a vector so semantically related events can be retrieved.",
    mirrorsProduction: "The production worker calls config.embedder.embed(rawEvent.input.text).",
    simplification: "The demo uses a deterministic eight-dimensional vector rather than an external model.",
    embeddingDimension: embedding.length,
    embeddingPreview: embedding.slice(0, 4),
  });

  const importanceScore = scoreImportance(rawEvent);
  trace.push({
    stage: "score_importance",
    concept: "A provisional priority is computed before later consolidation and reinforcement.",
    mirrorsProduction: "The demo uses the same weighting scheme as the ingestion scorer.",
    importanceScore,
    signals: {
      eventType: rawEvent.type,
      tags: rawEvent.tags.length,
      hasAction: Boolean(rawEvent.action),
      success: rawEvent.result?.success ?? null,
    },
  });

  const objectStorageKey = eventKey(rawEvent.eventId, rawEvent.timestamp);
  trace.push({
    stage: "derive_object_key",
    concept: "The full event is addressable by a deterministic key based on event ID and timestamp.",
    mirrorsProduction: "The key format matches the memory-objectstore eventKey helper.",
    objectStorageKey,
  });

  const archivedEvent = {
    ...rawEvent,
    input: {
      ...rawEvent.input,
      embedding,
    },
    importanceScore,
    objectStorageKey,
  };

  const indexDocument = {
    event_id: rawEvent.eventId,
    timestamp: rawEvent.timestamp,
    event_type: rawEvent.type,
    session_id: rawEvent.context.sessionId,
    summary: rawEvent.input.text.slice(0, 240),
    embedding,
    importance_score: importanceScore,
    reward_score: rawEvent.evaluation?.rewardScore ?? 0.5,
    confidence: rawEvent.internalState?.confidence ?? 0.5,
    retrieval_count: 0,
    decay_factor: 1,
    object_storage_key: objectStorageKey,
    tags: rawEvent.tags,
  };

  const enrichedPayload = {
    eventId: rawEvent.eventId,
    timestamp: rawEvent.timestamp,
    importanceScore,
    embeddingDimension: embedding.length,
    objectStorageKey,
    tags: rawEvent.tags,
  };

  const indexedPayload = {
    eventId: rawEvent.eventId,
    timestamp: rawEvent.timestamp,
    index: "experience_events",
    objectStorageKey,
  };

  assert.equal(archivedEvent.action?.reasoning, rawEvent.action?.reasoning);
  assert.equal(indexDocument.object_storage_key, archivedEvent.objectStorageKey);
  assert.equal(enrichedPayload.embeddingDimension, archivedEvent.input.embedding.length);
  assert.equal(indexedPayload.objectStorageKey, archivedEvent.objectStorageKey);

  trace.push({
    stage: "separate_truth_from_retrieval",
    concept: "The archive keeps full causal detail while the index keeps compact retrieval metadata.",
    mirrorsProduction: "The production worker writes the enriched event to object storage and metadata plus embedding to OpenSearch.",
    simplification: "Local JSON files stand in for S3 and OpenSearch.",
    archiveContainsReasoning: Boolean(archivedEvent.action?.reasoning),
    indexContainsPointer: Boolean(indexDocument.object_storage_key),
  });

  trace.push({
    stage: "emit_downstream_messages",
    concept: "Compact Kafka-style messages announce enrichment and indexing without duplicating the full event.",
    mirrorsProduction: "The payload fields and topic names match the ingestion worker's downstream messages.",
    simplification: "The demo writes topic payloads to files rather than publishing to Kafka.",
    topics: [Topics.EXPERIENCE_ENRICHED, Topics.MEMORY_INDEXED],
  });

  await rm(outputDir, { recursive: true, force: true });
  await writeJson(join(outputDir, "object-store", objectStorageKey), archivedEvent);
  await writeJson(join(outputDir, "opensearch", "experience_events", `${rawEvent.eventId}.json`), indexDocument);
  await writeJson(join(outputDir, "kafka", `${Topics.EXPERIENCE_ENRICHED}.json`), enrichedPayload);
  await writeJson(join(outputDir, "kafka", `${Topics.MEMORY_INDEXED}.json`), indexedPayload);
  await writeJson(join(outputDir, "trace", "ingestion-trace.json"), trace);
  await writeJson(join(outputDir, "summary.json"), {
    eventId: rawEvent.eventId,
    objectStorageKey,
    importanceScore,
    embeddingDimension: embedding.length,
    emittedTopics: [Topics.EXPERIENCE_ENRICHED, Topics.MEMORY_INDEXED],
    representationMap,
    verifiedInvariants: [
      "archive retains full reasoning context",
      "index points back to archived payload",
      "enriched payload reports embedding dimension",
      "indexed payload confirms queryable memory reference",
    ],
  });

  return {
    archivedEvent,
    indexDocument,
    trace,
    messages: [
      { topic: Topics.EXPERIENCE_ENRICHED, payload: enrichedPayload },
      { topic: Topics.MEMORY_INDEXED, payload: indexedPayload },
    ],
  };
}

const rawEvent = {
  eventId: "demo-event-001",
  timestamp: "2026-05-08T22:31:25.237Z",
  type: "user_input",
  context: {
    sessionId: "demo-session-001",
    traceId: "demo-trace-001",
  },
  input: {
    text: "Design a memory system that preserves complete experience while supporting fast associative retrieval.",
    embedding: [],
  },
  internalState: {
    confidence: 0.72,
    activePlan: "Compare object storage truth with OpenSearch retrieval metadata.",
  },
  action: {
    tool: "architecture_note",
    reasoning: "Capture the event before downstream learning changes its priority.",
  },
  result: {
    output: "Experience archived and indexed.",
    success: true,
    latencyMs: 42,
  },
  evaluation: {
    rewardScore: 0.81,
    selfAssessedQuality: 0.76,
  },
  importanceScore: 0,
  tags: ["memory", "ingestion", "demo"],
};

const result = await processEvent(rawEvent);

console.log("Experience ingestion demo complete");
console.log(`Object key: ${result.archivedEvent.objectStorageKey}`);
console.log(`Importance score: ${result.archivedEvent.importanceScore}`);
console.log(`Embedding dimension: ${result.archivedEvent.input.embedding.length}`);
console.log("Verified invariants:");
console.log("- archive retains full reasoning context");
console.log("- index points back to archived payload");
console.log("- emitted messages carry compact references");
console.log("Trace stages:");
for (const step of result.trace) {
  console.log(`- ${step.stage}`);
}
console.log("Representation map:");
for (const item of representationMap) {
  console.log(`- ${item.concept}: demo mirrors ${item.production}`);
}
console.log("Emitted topics:");
for (const message of result.messages) {
  console.log(`- ${message.topic}`);
}
console.log(`Output written to: ${outputDir}`);
