# Architecture Inventory

Built vs drafted status for packages and production wiring. Companion to
[`package-map.md`](package-map.md). Last updated 2026-07-13.

**Lab OpenSearch:** thor and local multi-node compose pin **OpenSearch 3.6.0**
(+ Dashboards 3.6.0). Smoke compose remains on 2.15 for light CI. Thor rolling
upgrades must use compose project `docker`
(`docker compose -p docker -f docker-compose.thor.yml ...`) so existing
`docker_opensearch-*-data` volumes are reused.

Status legend:

- **built** — package exists, typed, and exercised by experiments or live workers
- **wired** — running in thor app stack (compose and/or systemd)
- **drafted** — interface or stub present; production path incomplete
- **planned** — called out by experiments; not started

## Core infrastructure

| Package / service | Status | Notes |
|-------------------|--------|-------|
| `core-types` | built | Shared schemas and index names |
| `memory-opensearch` | built / wired | Lucene knn defaults (Exp 49); lab cluster OpenSearch **3.6.0**; `ensureExperienceEventsEmbedPipeline` attaches mpnet 768 `experience-events-embed` |
| `memory-objectstore` | built | MinIO on thor |
| `kafka-bus` | built / wired | Topic registry canonical |
| `telemetry-otel` | built / wired | OTEL collector → Kafka |
| `clickhouse-telemetry` | built / wired | Telemetry worker sink |
| `ingest-worker` | built / wired | `telemetry.logs.raw` → `experience_events`; compose service `worker-ingest-telemetry` (host `ingest-worker.service` still needs `sudo systemctl disable --now` when password available; dist stub parks the unit) |

## Cognitive engines

| Package | Status | Notes |
|---------|--------|-------|
| `retrieval-engine` | built / wired | Hybrid BM25+knn; orchestrator wires OpenSearch ML cross-encoder when deployed |
| `attention-engine` | built | Validated Exp 6+ |
| `policy-engine` | built / wired | `applyExplorationRecovery` (Exp 54); orchestrator applies evaluations |
| `agents` / CognitiveLoop | built / wired | LLM preferred via `CS_ENGINE_ORDER` when keys/URL present; multi-agent last |
| `reinforcement-engine` | built / wired | Worker + periodic blog salience pass (Exp 50 path) |
| `consolidation-engine` | built / wired | Worker |
| `decay-engine` | built | Re-consolidation interval ≤5 epochs |
| Series II engines (affect, causal, curiosity, dream, etc.) | built | In-process validation Exp 21–27 |
| `introspection-engine` | built | Exp 48; proposals in `substrate_proposals` |
| `constitution-engine` | built | Gates introspection proposals |

## Apps / workers (thor)

| Service | Status | Notes |
|---------|--------|-------|
| `cs-api` | wired | `:4000` |
| `cs-orchestrator` | wired | Reranker + policy apply + LLM order |
| `cs-worker-ingestion` | wired | `experience.raw` path |
| `cs-worker-ingest-telemetry` | wired | Blog telemetry path |
| `cs-worker-consolidation` | wired | |
| `cs-worker-reinforcement` | wired | Kafka outcomes + scheduled blog reinforcement |
| `cs-worker-pattern` | wired | |
| `cs-worker-telemetry` | wired | Skips cognitive blog events on logs topic |
| `cs-worker-memory-critique` | wired | MCE pipeline (Exp 47) |
| `cs-web` | wired | `:3007` |

## Production hardening backlog

| Item | Status | Source | Next action |
|------|--------|--------|-------------|
| ms-marco / cross-encoder reranker | built / wired | Exp 36, 43, 53 | Deployed `bjcSXJ8BApsVNgKs81sB`; set `OPENSEARCH_RERANKER_MODEL_ID` |
| Policy recovery after `explorationFactor` → 0 | built | Exp 41, 44, 54 | `applyExplorationRecovery` + orchestrator `applyEvaluation` |
| LLM-backed agents / `EnginePlugin` defaults | built / wired | Exp 38, 55 | `CS_ENGINE_ORDER=claude,ollama,...`; plugins via `CS_ENGINE` |
| Independent eval suite | built | Exp 56–58 | Baseline, holdout, sensitivity grid |
| Diversity slot in core `MemoryRetriever` | drafted | Exp 35 | Promote experiment `breadth.ts` slot into production retriever |
| Host systemd → compose migration | planned | Ops 2026-07-10 | `sudo systemctl disable --now ingest-worker.service` (password required on thor) |
| Production 1-bit SQ remap | deferred | Exp 51 | Larger-n size study first |

## Embedding contract (live blog memory)

- Pipeline: `experience-events-embed` → model `YYGXOJ4BgYB_vs2klaSo` (all-mpnet-base-v2)
- Field: `experience_events.embedding` dimension **768**
- Probe experiments (45 H3, 52, 56, 57) must use mpnet, not MiniLM 384
- Ingest writers rely on index `default_pipeline` (also ensured at orchestrator/ingest startup)

## Index naming notes

- Introspection proposals live in `substrate_proposals` (Exp 48). Older docs may say `self_modifications`.
- Blog reader events land in `experience_events` with `tags: blog`, not in `blog_posts_search` (blog catalog only).
