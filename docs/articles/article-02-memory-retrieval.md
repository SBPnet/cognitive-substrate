# Stage 2: Memory Retrieval

## Claim

Memory retrieval turns stored experience into active cognitive context. The implemented layer supports hybrid retrieval over OpenSearch memory indexes, combines lexical and vector recall, applies ranking signals, and can record retrieval feedback. It does not yet prove retrieval quality improvements without corpus-level evaluation.

## Runtime Surface

The main implementation is `packages/retrieval-engine/` with query construction and schemas in `packages/memory-opensearch/`. Retrieval reads from `experience_events` and `memory_semantic`, maps OpenSearch hits into memory references, optionally applies reranking, and can write feedback records to `retrieval_feedback`.

The query path supports quality, efficient, hybrid, and legacy vector lanes through `packages/memory-opensearch/src/query-builder.ts` and `packages/retrieval-engine/src/retriever.ts`. The runtime schema source is `packages/memory-opensearch/src/schemas.ts`.

## Evidence

`packages/retrieval-engine/src/__tests__/retrieval-mode.test.ts` covers retrieval-mode behavior, and `packages/memory-opensearch/src/__tests__/model-swap.test.ts` covers model-profile switching. The architecture inventory records Stage 2 as implemented with focused tests.

## Limitations

Retrieval quality, recall improvement, ranking gains, and reranker value remain empirical questions. Strong claims require indexed corpora, query sets, relevance judgments, and ablation results.
