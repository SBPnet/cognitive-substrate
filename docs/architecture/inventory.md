# Architecture Inventory

Built vs drafted status for packages and production wiring. Companion to
[`package-map.md`](package-map.md). Last updated 2026-07-10.

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
| `memory-opensearch` | built / wired | Lucene knn defaults (Exp 49); lab cluster OpenSearch **3.6.0** |
| `memory-objectstore` | built | MinIO on thor |
| `kafka-bus` | built / wired | Topic registry canonical |
| `telemetry-otel` | built / wired | OTEL collector → Kafka |
| `clickhouse-telemetry` | built / wired | Telemetry worker sink |
| `ingest-worker` | built / wired | `telemetry.logs.raw` → `experience_events`; compose service `worker-ingest-telemetry` (disable host `ingest-worker.service` when using compose) |

## Cognitive engines

| Package | Status | Notes |
|---------|--------|-------|
| `retrieval-engine` | built | Hybrid BM25+knn; optional reranker interface |
| `attention-engine` | built | Validated Exp 6+ |
| `policy-engine` | built | ef collapse post-incident (Exp 41/44) |
| `agents` / CognitiveLoop | built | Stub agents default; LLM plugin path drafted |
| `reinforcement-engine` | built / wired | Worker + Exp 46/50 |
| `consolidation-engine` | built / wired | Worker |
| `decay-engine` | built | Re-consolidation interval ≤5 epochs |
| Series II engines (affect, causal, curiosity, dream, etc.) | built | In-process validation Exp 21–27 |
| `introspection-engine` | built | Exp 48; proposals in `substrate_proposals` |
| `constitution-engine` | built | Gates introspection proposals |

## Apps / workers (thor)

| Service | Status | Notes |
|---------|--------|-------|
| `cs-api` | wired | `:4000` |
| `cs-orchestrator` | wired | Stub/LLM via env |
| `cs-worker-ingestion` | wired | `experience.raw` path |
| `cs-worker-ingest-telemetry` | wired | Blog telemetry path |
| `cs-worker-consolidation` | wired | |
| `cs-worker-reinforcement` | wired | |
| `cs-worker-pattern` | wired | |
| `cs-worker-telemetry` | wired | Skips cognitive blog events on logs topic |
| `cs-worker-memory-critique` | wired | MCE pipeline (Exp 47) |
| `cs-web` | wired | `:3007` |

## Production hardening backlog

| Item | Status | Source | Next action |
|------|--------|--------|-------------|
| ms-marco / cross-encoder reranker | drafted | Exp 36, 43 | Deploy OpenSearch ML rerank model; set `hasReranker: true` in production retriever config |
| Policy recovery after `explorationFactor` → 0 | planned | Exp 41, 44 | Add recovery-phase positive reinforcement or explicit ef reset when severity returns to normal |
| LLM-backed agents / `EnginePlugin` defaults | drafted | Exp 38 | Wire `EnginePlugin` / Anthropic or Ollama reasoning model as non-stub default in orchestrator |
| Independent eval suite | planned | `docs/experiments.md` limitations | New experiment numbers (not 45–47): non-cognitive baseline, held-out corpus, parameter sensitivity grid |
| Diversity slot in core `MemoryRetriever` | drafted | Exp 35 | Promote experiment `breadth.ts` slot into production retriever |
| Host systemd → compose migration | planned | Ops 2026-07-10 | `sudo systemctl disable --now ingest-worker.service` once compose path is sole owner |

## Index naming notes

- Introspection proposals live in `substrate_proposals` (Exp 48). Older docs may say `self_modifications`.
- Blog reader events land in `experience_events` with `tags: blog`, not in `blog_posts_search` (blog catalog only).
