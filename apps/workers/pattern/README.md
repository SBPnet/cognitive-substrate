# @cognitive-substrate/pattern-worker

## Purpose

`@cognitive-substrate/pattern-worker` is a worker application. Its source lives in `apps/workers/pattern/src/` and should be evaluated by the Kafka topics, storage clients, and environment flags it actually imports.

## Entrypoints

- Source: `apps/workers/pattern/src/main.ts`
- Package main: `./dist/main.js`
- Package metadata: `apps/workers/pattern/package.json`

## Runtime Wiring

Runtime wiring is owned by the worker process entrypoint and environment configuration. Kafka topic claims should be checked against `packages/kafka-bus/src/topics.ts` and the worker source.

## Evidence

Evidence is limited to build/typecheck/import coverage and any downstream smoke usage that imports this package or runs this worker.
