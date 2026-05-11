# Deep Smoke Baseline Report

Status: passed
Run ID: 2026-05-11T01-15-17-223Z
Git SHA: f7176ec
Started: 2026-05-11T01:15:17.224Z
Finished: 2026-05-11T01:16:33.624Z
Duration: 76400 ms

## Phases

- passed: package-baseline (18360 ms)
- passed: aiven-collector-contract (269 ms)
- passed: telemetry-experience-bridge-contract (289 ms)
- passed: open-ended-probe (131 ms)
- passed: copy-env-examples (0 ms)
- passed: infra-start (6926 ms)
- passed: infra-readiness (1084 ms)
- passed: embedding-model-swap (12448 ms)
- passed: init-kafka-topics (494 ms)
- passed: init-clickhouse (371 ms)
- passed: app-start (5010 ms)
- passed: app-readiness (550 ms)
- passed: cognitive-flow (13496 ms)
- passed: telemetry-flow (7197 ms)
- passed: assertions (86 ms)

## Assertions

- passed: embedding quality vector field present, expected profile vector field exists, actual true
- passed: embedding quality retrieval results, expected each model-swap query returns at least one result, actual 3,3,3,3,3,3
- passed: embedding efficient vector field present, expected profile vector field exists, actual true
- passed: embedding efficient retrieval results, expected each model-swap query returns at least one result, actual 3,3,3,3,3,3
- passed: embedding report quality vector field present, expected passed, actual true
- passed: embedding report quality retrieval returned results, expected passed, actual authentication latency spike during peak load:3, database connection exhaustion timeout:3, deployment causing elevated error rates:3, HTTP_504 auth-service us-east-1:3, DISK_FULL storage-node us-west-2:3, JWT_EXPIRED clock-drift v2.4.1:3
- passed: embedding report efficient vector field present, expected passed, actual true
- passed: embedding report efficient retrieval returned results, expected passed, actual authentication latency spike during peak load:3, database connection exhaustion timeout:3, deployment causing elevated error rates:3, HTTP_504 auth-service us-east-1:3, DISK_FULL storage-node us-west-2:3, JWT_EXPIRED clock-drift v2.4.1:3
- passed: opensearch experience_events, expected >= 1, actual 7
- passed: opensearch memory_semantic, expected >= 1, actual 1
- passed: opensearch audit_events, expected >= 1, actual 20
- passed: opensearch agent_activity, expected >= 1, actual 12
- passed: clickhouse metrics_raw, expected >= 1, actual 16
- passed: clickhouse logs_raw, expected >= 1, actual 1
- passed: clickhouse cognitive_events, expected >= 1, actual 32
- passed: object store event payloads, expected >= 1, actual 7
- passed: api trace events, expected >= 1, actual 8
- passed: api agent activities, expected >= 1, actual 12
- passed: service processes alive, expected all services alive through assertion phase, actual all alive

## Metrics

- api.agent_activities: 12
- api.trace_events: 8
- clickhouse.cognitive_events: 32
- clickhouse.logs_raw: 1
- clickhouse.metrics_raw: 16
- embedding_model_swap.active_lanes: quality,efficient
- embedding_model_swap.efficient.query_count: 6
- embedding_model_swap.efficient.vector_field: embedding_nomic
- embedding_model_swap.profile_count: 2
- embedding_model_swap.quality.query_count: 6
- embedding_model_swap.quality.vector_field: embedding_qwen
- objectstore.events: 7
- objectstore.sample_key: events/2026/05/11/13acca92-fc51-42bc-958b-acdda2a7ac19.json
- opensearch.agent_activity: 12
- opensearch.audit_events: 20
- opensearch.experience_events: 7
- opensearch.memory_semantic: 1

## Package Coverage

- @cognitive-substrate/api (apps/api): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/orchestrator (apps/orchestrator): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/web (apps/web): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/aiven-collector-worker (apps/workers/aiven-collector): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/consolidation-worker (apps/workers/consolidation): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/ingestion-worker (apps/workers/ingestion): build, launched-service, runtime-probe, typecheck, unit-test
- @cognitive-substrate/pattern-worker (apps/workers/pattern): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/reinforcement-worker (apps/workers/reinforcement): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/telemetry-worker (apps/workers/telemetry): build, launched-service, runtime-probe, typecheck
- @cognitive-substrate/abstraction-engine (packages/abstraction-engine): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: pattern, telemetry
- @cognitive-substrate/affect-engine (packages/affect-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/agents (packages/agents): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: orchestrator
- @cognitive-substrate/aiven-client (packages/aiven-client): build, entrypoint-import, runtime-direct, typecheck, sources: aiven-collector, api
- @cognitive-substrate/attention-engine (packages/attention-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/budget-engine (packages/budget-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/causal-engine (packages/causal-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/clickhouse-telemetry (packages/clickhouse-telemetry): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: pattern, reinforcement, telemetry
- @cognitive-substrate/consolidation-engine (packages/consolidation-engine): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: consolidation
- @cognitive-substrate/constitution-engine (packages/constitution-engine): build, entrypoint-import, runtime-direct, typecheck, sources: open-ended-probe, orchestrator
- @cognitive-substrate/core-types (packages/core-types): build, entrypoint-import, runtime-direct, runtime-probe, runtime-transitive, typecheck, sources: api, consolidation, ingestion, orchestrator, pattern, reinforcement, telemetry
- @cognitive-substrate/curiosity-engine (packages/curiosity-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/decay-engine (packages/decay-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/development-engine (packages/development-engine): build, entrypoint-import, runtime-direct, typecheck, sources: open-ended-probe, orchestrator
- @cognitive-substrate/dream-engine (packages/dream-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/grounding-engine (packages/grounding-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/kafka-bus (packages/kafka-bus): build, entrypoint-import, runtime-direct, runtime-probe, runtime-transitive, typecheck, sources: aiven-collector, api, consolidation, ingestion, orchestrator, pattern, reinforcement, telemetry
- @cognitive-substrate/memory-objectstore (packages/memory-objectstore): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: ingestion
- @cognitive-substrate/memory-opensearch (packages/memory-opensearch): build, entrypoint-import, runtime-direct, runtime-probe, runtime-transitive, typecheck, unit-test, sources: api, consolidation, ingestion, orchestrator, pattern, reinforcement
- @cognitive-substrate/metacog-engine (packages/metacog-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/narrative-engine (packages/narrative-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/policy-engine (packages/policy-engine): build, entrypoint-import, runtime-direct, runtime-probe, runtime-transitive, typecheck, sources: orchestrator, reinforcement
- @cognitive-substrate/reinforcement-engine (packages/reinforcement-engine): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: reinforcement
- @cognitive-substrate/retrieval-engine (packages/retrieval-engine): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, unit-test, sources: orchestrator
- @cognitive-substrate/social-engine (packages/social-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/telemetry-otel (packages/telemetry-otel): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: aiven-collector, api, consolidation, ingestion, orchestrator, pattern, reinforcement, telemetry
- @cognitive-substrate/temporal-engine (packages/temporal-engine): build, entrypoint-import, typecheck
- @cognitive-substrate/world-model (packages/world-model): build, entrypoint-import, runtime-direct, runtime-probe, typecheck, sources: orchestrator

## Service Logs

- ingestion: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-ingestion.log
- consolidation: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-consolidation.log
- telemetry: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-telemetry.log
- pattern: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-pattern.log
- reinforcement: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-reinforcement.log
- aiven-collector: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-aiven-collector.log
- orchestrator: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-orchestrator.log
- api: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-api.log
- web: artifacts/smoke/deep-smoke-2026-05-11T01-15-17-223Z/logs/service-web.log

