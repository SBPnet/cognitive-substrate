import assert from "node:assert/strict";

import {
  INDEX_SCHEMAS,
  RETRIEVAL_MODE_VECTOR_FIELD,
  buildHybridQuery,
  embeddingProfilesFromEnv,
} from "../index.js";

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

function propertyMap(indexName: keyof typeof INDEX_SCHEMAS): Record<string, unknown> {
  const schema = INDEX_SCHEMAS[indexName];
  return asRecord(asRecord(schema.mappings)["properties"]);
}

process.env["EMBEDDING_LANES"] = "quality,efficient";
process.env["QUALITY_EMBEDDING_PROVIDER"] = "stub";
process.env["EFFICIENT_EMBEDDING_PROVIDER"] = "stub";

const profiles = embeddingProfilesFromEnv();
assert.deepEqual(profiles.map((profile) => profile.lane), ["quality", "efficient"]);
assert.equal(profiles[0]?.vectorField, "embedding_qwen");
assert.equal(profiles[1]?.vectorField, "embedding_nomic");
assert.equal(profiles[0]?.dimension, 1024);
assert.equal(profiles[1]?.dimension, 768);

const experienceProperties = propertyMap("experience_events");
assert.equal(asRecord(experienceProperties["embedding_qwen"])["type"], "knn_vector");
assert.equal(asRecord(experienceProperties["embedding_qwen"])["dimension"], 1024);
assert.equal(asRecord(experienceProperties["embedding_nomic"])["dimension"], 768);
assert.equal(asRecord(experienceProperties["embedding_meta"])["type"], "object");

const semanticProperties = propertyMap("memory_semantic");
assert.equal(asRecord(semanticProperties["embedding_bge_m3"])["type"], "knn_vector");

const registryProperties = propertyMap("model_registry");
assert.equal(asRecord(registryProperties["profile_id"])["type"], "keyword");
assert.equal(asRecord(registryProperties["dimension"])["type"], "integer");

const query = buildHybridQuery({
  queryText: "authentication latency",
  queryEmbedding: [0.1, 0.2, 0.3],
  retrievalMode: "efficient",
  fusion: { lexicalWeight: 2, vectorWeight: 5 },
  k: 7,
});

const queryBody = JSON.stringify(query);
assert.match(queryBody, /"embedding_nomic"/);
assert.match(queryBody, /"boost":5/);
assert.match(queryBody, /"boost":2/);
assert.equal(RETRIEVAL_MODE_VECTOR_FIELD.hybrid, "embedding_bge_m3");

process.stdout.write("[memory-opensearch] model-swap tests passed\n");
