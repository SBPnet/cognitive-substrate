# Experience Ingestion Companion

This companion bundle accompanies the article `Stage 1: Capturing Experience: The Foundation of Cognitive Memory`. It provides a small runnable demonstration and static publication diagrams that illustrate the ingestion pipeline described in the article.

The article describes how a raw experience becomes an archived event, an associative search document, and a pair of downstream Kafka signals. This bundle makes those artifacts inspectable without requiring the full repository context.

## Quick Run

The fastest way to inspect the ingestion flow is the dependency-free Node demo:

```bash
node docs/articles/companions/article-01-experience-ingestion/runnable/experience-ingestion-demo.mjs
```

The demo writes local JSON files under `runnable/out/`:

- `object-store/`: the complete archived experience event.
- `opensearch/`: the retrieval metadata document and embedding vector.
- `kafka/`: local payloads for `experience.enriched` and `memory.indexed`.
- `trace/`: a stage-by-stage explanation of the ingestion flow.
- `summary.json`: a compact summary of the output and verified invariants.

The demo supports the article at the data-shape level. It shows the event schema, embedding attachment, initial importance scoring, deterministic object key, index document, and downstream message payloads. Kafka, OpenSearch, S3, and OpenTelemetry are represented by local files so the flow remains easy to run and inspect.

## What This Demonstrates

The runnable demo demonstrates the article's core ingestion contract:

- A raw experience event contains input, context, internal state, action, result, evaluation, and tags.
- The ingestion step attaches an embedding and computes an initial importance score.
- The complete enriched event is archived under a deterministic object key.
- The associative index stores metadata, an embedding vector, scoring fields, tags, and a pointer back to the archived payload.
- The pipeline emits compact downstream messages for enrichment consumers and indexed-memory notifications.
- The demo verifies that the archive retains full reasoning context, the index points back to the archive, and the emitted messages carry compact references.

The demo intentionally avoids production infrastructure. It mirrors the production ingestion order and payload boundaries, while substituting local JSON files for S3, OpenSearch, and Kafka. The embedding is deterministic and small so repeated runs produce inspectable output. The stage trace documents these substitutions directly in `runnable/out/trace/ingestion-trace.json`.

## Bundle Contents

- `runnable/`: a minimal Node implementation of the ingestion flow, plus generated sample output.
- `images/`: generated SVG and PNG for the pipeline diagram (source of truth is [`docs/diagrams/article-01-experience-ingestion.mmd`](../../../diagrams/article-01-experience-ingestion.mmd), not duplicated here). Regenerate from the repository root after editing that file: `pnpm docs:diagram:article-01`.

The runnable demo is the public-facing entrypoint for this companion bundle. Concise source snippets appear in the article itself.
