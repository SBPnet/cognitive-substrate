# @cognitive-substrate/ingestion-worker

## Purpose

`@cognitive-substrate/ingestion-worker` is a worker application. Its source lives in `apps/workers/ingestion/src/` and should be evaluated by the Kafka topics, storage clients, and environment flags it actually imports.

## Entrypoints

- Source: `apps/workers/ingestion/src/main.ts`
- Package main: `./dist/main.js`
- Package metadata: `apps/workers/ingestion/package.json`

## Runtime Wiring

Runtime wiring is owned by the worker process entrypoint and environment configuration. Kafka topic claims should be checked against `packages/kafka-bus/src/topics.ts` and the worker source.

## Evidence

Focused tests exist under `src/__tests__/` where present; otherwise evidence is limited to build/typecheck/import coverage and downstream smoke usage.
