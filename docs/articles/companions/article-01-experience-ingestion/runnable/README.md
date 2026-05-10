# Runnable Experience Ingestion Demo

This demo is a small, dependency-free version of the Stage 1 ingestion flow described in the article.

It models the same architectural steps as the production worker:

1. Create a raw `ExperienceEvent`.
2. Generate a deterministic stub embedding.
3. Compute an initial importance score.
4. Archive the full event under a deterministic object-storage key.
5. Write an OpenSearch-style metadata document.
6. Emit `experience.enriched` and `memory.indexed` payloads.
7. Write a stage trace and verify the core archive, index, and message invariants.

## Run

```bash
node docs/articles/companions/article-01-experience-ingestion/runnable/experience-ingestion-demo.mjs
```

The script writes output files under:

```text
docs/articles/companions/article-01-experience-ingestion/runnable/out/
```

The output folder contains local stand-ins for the production layers:

- `object-store/`: complete archived experience event.
- `opensearch/`: retrieval metadata and embedding vector.
- `kafka/`: downstream topic payloads.
- `trace/`: stage-by-stage explanation of the ingestion flow.
- `summary.json`: compact result summary, verified invariants, and a map from demo concepts to production counterparts.

This demo uses only Node built-in modules. Kafka, OpenSearch, S3, and OpenTelemetry are represented as local JSON files so the ingestion data shape can be inspected without infrastructure. The demo mirrors the production order and payload boundaries, but it does not exercise network clients, external embedding models, Kafka headers, OpenSearch mappings, or S3 write behavior.
