# @cognitive-substrate/retrieval-engine

## Purpose

`@cognitive-substrate/retrieval-engine` is a top-level package used by the Cognitive Substrate workspace. Its public API is the package export surface, not this README.

## Entrypoints

- Source: `packages/retrieval-engine/src/index.ts`
- Package main: `./dist/index.js`
- Package metadata: `packages/retrieval-engine/package.json`

## Runtime Wiring

Runtime wiring happens through apps, workers, or other packages that import this package. Kafka topic claims should be checked against `packages/kafka-bus/src/topics.ts`; OpenSearch index claims should be checked against `packages/memory-opensearch/src/schemas.ts`.

## Evidence

Focused tests exist under `src/__tests__/` where present; otherwise evidence is limited to build/typecheck/import coverage and downstream smoke usage.
