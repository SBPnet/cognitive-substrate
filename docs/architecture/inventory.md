---
title: Stage Implementation Inventory
category: architecture
status: living
---

# Stage Implementation Inventory

This matrix records the implementation status of each stage: primary packages and corresponding architecture documentation. It is updated as each stage lands.

**Status key:** `implemented + behavioral` = TypeScript sources exist and a smoke/runtime probe exercises the stage; `implemented + focused tests` = source plus package-level or worker-level tests but no full runtime probe; `implemented + entrypoint-import only` = source exists and imports/builds, but no behavioral evidence; `partial` = source exists but documented wiring is incomplete; `doc-only` = referenced in docs but no code on disk.

**Evidence note:** `entrypoint-import` confirms module loadability only. It is not production readiness, behavioral completeness, or longitudinal validation. Runtime demonstrations, smoke coverage, and empirical evaluation are tracked separately in tests, smoke reports, and evaluation baselines.

---

## Series I: Self-Modifying Cognitive Architectures

| Stage | Name | Primary packages / apps | Architecture doc(s) | Status |
|-------|------|-------------------------|---------------------|--------|
| 1 | Experience Ingestion | `apps/workers/ingestion/`, `packages/core-types/`, `packages/kafka-bus/`, `packages/memory-opensearch/`, `packages/memory-objectstore/`, `packages/telemetry-otel/` | `kafka-pipeline.md`, `opensearch-schema.md`, `opensearch-topology.md`, `otel-observability.md`, `aiven-deployment.md` | implemented + behavioral |
| 2 | Memory Retrieval | `packages/memory-opensearch/`, `packages/retrieval-engine/` | `opensearch-schema.md`, `opensearch-topology.md` | implemented + focused tests |
| 3 | Consolidation Worker | `apps/workers/consolidation/`, `packages/consolidation-engine/` | `consolidation-worker.md`, `kafka-pipeline.md` | implemented + behavioral |
| 4 | Policy Engine | `packages/policy-engine/` | none | implemented + behavioral |
| 5 | Cognitive Agent Loop | `apps/orchestrator/`, `packages/agents/` | `agent-runtime.md` | implemented + behavioral |
| 6 | Multi-Agent Decomposition | `packages/agents/` | `agent-runtime.md` | implemented + behavioral |
| 7 | Internal Debate and Arbitration | `packages/agents/` | `agent-runtime.md` | implemented + behavioral |
| 8 | Self-Reflection Loop | `packages/metacog-engine/` | none | implemented + entrypoint-import only |
| 9 | Reinforcement Scoring Engine | `packages/reinforcement-engine/` | `reinforcement-engine.md` | partial |
| 10 | Identity Formation | `packages/narrative-engine/` | none | implemented + entrypoint-import only |
| 11 | World Model | `packages/world-model/` | none | implemented + behavioral |
| 12 | Long-Horizon Goals | `packages/agents/` | none | implemented + behavioral |
| 13 | Multi-Agent Society | `apps/orchestrator/`, `infra/k8s/` | `agent-runtime.md`, `aiven-deployment.md` | implemented + behavioral |

### Architecture coverage gaps: Series I

The following stages have implemented code but no dedicated architecture document. Adding architecture docs for these stages is recommended before treating those stages as specification-complete for external readers.

- Stage 4 (Policy Engine): policy vector store, reward delta computation, clamped drift update, version snapshots.
- Stage 10 (Identity Formation): long-running identity vector accumulation, narrative self-model synthesis, coherence scoring.
- Stage 11 (World Model): LLM-driven outcome simulation, risk scoring, prediction record schema.
- Stage 12 (Long-Horizon Goals): goal hierarchy schema, decomposition strategy, progress event schema.

The Series I table also references several planned cross-cutting architecture documents that are not yet present on disk. Until those documents exist, treat those references as doc debt rather than published specifications.

---

## Series II: Emergent Cognitive Systems

| Stage | Name | Primary packages / apps | Architecture doc(s) | Status |
|-------|------|-------------------------|---------------------|--------|
| 14 | Attention Engine | `packages/attention-engine/` | `attention-modes.md` | implemented + entrypoint-import only |
| 15 | Temporal Cognition | `packages/temporal-engine/` | none | implemented + entrypoint-import only |
| 16 | Cognitive Economics | `packages/budget-engine/` | none | implemented + entrypoint-import only |
| 17 | Forgetting System | `packages/decay-engine/` | none | implemented + entrypoint-import only |
| 18 | Affect Modulation | `packages/affect-engine/` | `multi-circuit-reward.md` | implemented + entrypoint-import only |
| 19 | Narrative Selfhood | `packages/narrative-engine/` | none | implemented + entrypoint-import only |
| 20 | Meta-Cognition | `packages/metacog-engine/` | none | implemented + entrypoint-import only |
| 21 | Social Cognition | `packages/social-engine/` | none | implemented + entrypoint-import only |
| 22 | Grounded Cognition | `packages/grounding-engine/` | none | implemented + entrypoint-import only |
| 23 | Constitutional Stability | `packages/constitution-engine/` | none | implemented + focused tests |
| 24 | Causal Intelligence | `packages/causal-engine/` | none | implemented + entrypoint-import only |
| 25 | Curiosity Engine | `packages/curiosity-engine/` | none | implemented + entrypoint-import only |
| 26 | Dreaming System | `packages/dream-engine/` | none | implemented + entrypoint-import only |
| 27 | Recursive Abstraction | `packages/abstraction-engine/` | none | implemented + behavioral |
| 28 | Developmental Cognition | `packages/development-engine/` | none | implemented + focused tests |
| 29 | Open-Ended Intelligence | `apps/orchestrator/` (open-ended mode) | none | implemented + focused tests |

### Architecture coverage gaps: Series II

Stages 15 through 29 each have implemented TypeScript packages but no dedicated architecture document. Recommended additions before Series II is documented end-to-end:

- `architecture/temporal-engine.md`: timescale planning, urgency gradients, subjective computational time.
- `architecture/budget-engine.md`: compute quota schema, utility threshold gating, fast/slow cognition modes.
- `architecture/decay-engine.md`: retrieval suppression, compression hierarchies, graph pruning strategy.
- `architecture/affect-engine.md` (extends `multi-circuit-reward.md`): global affect vector schema, mood-like state representation.
- `architecture/constitution-engine.md`: invariant policy layer, mutation quarantine, immune monitoring.

---

## Series III: Operational Intelligence

| Stage | Name | Primary packages / apps | Architecture doc(s) | Status |
|-------|------|-------------------------|---------------------|--------|
| 30 | Operational Primitives | `packages/abstraction-engine/src/primitives/` | `operational-primitives.md` | implemented + behavioral |
| 31 | ClickHouse Telemetry Layer | `infra/aiven/clickhouse.tf`, `packages/clickhouse-telemetry/` | `clickhouse-telemetry.md`, `aiven-deployment.md` | partial |
| 32 | Telemetry Ingestion Worker | `apps/workers/telemetry/` | `kafka-pipeline.md` | partial |
| 33 | Pattern Detection Worker | `apps/workers/pattern/` | `operational-primitives.md` | partial |
| 34 | Reinforcement Feedback Worker | `apps/workers/reinforcement/` | `reinforcement-engine.md` | partial |
| 35 | OpenSearch ML Inference Nodes | `infra/aiven/opensearch.tf`, `packages/memory-opensearch/src/ml-inference.ts`, `packages/retrieval-engine/src/retriever.ts` | `opensearch-ml-nodes.md` | implemented + focused tests |
| 36 | Intelligence Transfer | `packages/abstraction-engine/src/primitives/mapping-layer.ts` | `operational-primitives.md` | partial |

---

## Cross-cutting architecture documents

The following documents cover concerns that span multiple stages. Existing documents are linked from this directory; planned documents are listed as doc debt until they are written.

| Document | Status | Stages covered |
|----------|--------|---------------|
| `inventory.md` | existing | Stage status, source surfaces, and architecture doc debt |
| `operational-primitives.md` | existing | Operational primitive taxonomy, mapping layer, pattern detection, transfer |
| `clickhouse-telemetry.md` | existing | Reference telemetry warehouse topology and ClickHouse schema |
| `opensearch-ml-nodes.md` | existing | OpenSearch ML inference placement and embedding/reranking topology |
| `attention-modes.md` | existing draft | Attention mode model and salience routing concepts |
| `multi-circuit-reward.md` | existing draft | Reinforcement and modulation signal model |
| `salience.md` | existing draft | Salience scoring and selection concepts |
| `branching-cognition.md` | existing draft | Branching cognition concepts |
| `../glossary.md` | existing | Canonical term definitions referenced by architecture docs |

### Cross-cutting doc debt

The following documents are referenced by stage rows or remain necessary for architecture readers, but are not yet published in `docs/architecture/`:

- `aiven-deployment.md`: deployment of Kafka, OpenSearch, PostgreSQL, ClickHouse, K8s/KEDA compute, and observability stack.
- `kafka-pipeline.md`: cognitive bus topology, topic namespaces, and cross-stage event flows.
- `otel-observability.md`: distributed tracing and metric conventions across all stages.
- `opensearch-schema.md`: index schemas for episodic memory, semantic memory, goals, agents, and policies.
- `opensearch-topology.md`: heterogeneous node topology and memory placement strategy.
- `agent-runtime.md`, `consolidation-worker.md`, `reinforcement-engine.md`, and per-engine Series II documents listed above.

### Current implementation gaps

These gaps are tracked separately from stage source availability:

- `apps/workers/telemetry/src/experience-bridge.ts` is wired when `TELEMETRY_EXPERIENCE_ENABLED=true`; keep deep smoke coverage current so this does not regress.
- `apps/workers/telemetry/` consumes `telemetry.metrics.raw`, `telemetry.logs.raw`, and `telemetry.metadata.raw`. Metrics feed primitive normalisation, logs are written to `logs_raw`, and all three can contribute to telemetry-as-experience summaries.
- `packages/clickhouse-telemetry/` defines insert paths for traces and incident reconstruction tables that are not yet populated by shipped workers.
- `packages/reinforcement-engine/` is buildable, but the reinforcement worker does not currently import it. Stage 9 therefore remains partial until that package participates in the runtime scoring path.
- `apps/workers/pattern/` has a seed-loading path that needs a regression test: an empty `operational_patterns` index should be populated from built-in seed patterns.
- `apps/orchestrator/` must keep its query embedder aligned with ingestion. A zero-vector query embedder is only valid for stub-mode smoke runs.
- `apps/api/src/routes/policy.ts` exposes self-modification, identity, and goals route groups that are placeholders until backed by real indices or explicitly returned as `501 Not Implemented`.
- `deploy/` currently contains generated package/app mirrors used for deployment packaging. Treat it as build output for audit and grep purposes; source-of-truth edits belong under top-level `apps/`, `packages/`, `docs/`, `infra/`, and `scripts/`.
