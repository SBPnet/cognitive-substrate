# Runnable experience ingestion demo

Small, dependency-free illustration of the Stage 1 ingestion flow (same steps as the production worker):

1. Build a raw `ExperienceEvent`.
2. Generate a deterministic stub embedding.
3. Compute an initial importance score.
4. Archive the full event under a deterministic object-storage key.
5. Write an OpenSearch-style metadata document.
6. Emit `experience.enriched` and `memory.indexed` payloads.
7. Write a stage trace and verify archive, index, and message invariants.

Design context: [`docs/architecture/kafka-pipeline.md`](../../docs/architecture/kafka-pipeline.md).

## Run

From the repository root:

```bash
node examples/experience-ingestion/experience-ingestion-demo.mjs
```

Output is written under:

```text
examples/experience-ingestion/out/
```

The output folder contains local stand-ins for the production layers:

- `object-store/`: complete archived experience event.
- `opensearch/`: retrieval metadata and embedding vector.
- `kafka/`: downstream topic payloads.
- `trace/`: stage-by-stage explanation of the ingestion flow.
- `summary.json`: compact result summary, verified invariants, and a map from demo concepts to production counterparts.

This demo uses only Node built-in modules. Kafka, OpenSearch, S3, and OpenTelemetry are represented as local JSON files so shapes can be inspected without infrastructure. It mirrors production ordering and payload boundaries but does not exercise network clients, external embedding models, Kafka headers, OpenSearch mappings, or S3 writes.
