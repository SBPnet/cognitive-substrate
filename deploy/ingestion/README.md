# Cognitive Substrate

A distributed cognitive infrastructure framework for persistent memory, adaptive retrieval, and event-driven AI systems.

This monorepo pairs runnable TypeScript implementations with formal research writing, architecture documentation, and publication-ready artifacts. The project treats memory, retrieval, salience, reinforcement, and observability as infrastructure concerns rather than prompt-level agent features.

## What This Is

Cognitive Substrate is positioned as:

- Distributed cognitive infrastructure
- Adaptive memory orchestration
- Event-driven cognition
- Persistent AI memory systems
- Associative retrieval architecture
- Salience-driven information processing
- Reinforcement-based memory prioritization

## What This Is Not

Cognitive Substrate is not positioned as:

- AGI
- Consciousness simulation
- Sentient AI
- Human-equivalent intelligence
- A chatbot framework
- Speculative science-fiction AI

Biological terminology is used only as computational analogy. The implementation claims infrastructure mechanisms, not biological equivalence.

## Repository Structure

```text
apps/
  orchestrator/          Cognitive runtime entrypoint
  api/                   API/BFF gateway between the web UI and Kafka/OpenSearch
  web/                   Cognitive workbench for conversation, memory, and trace inspection
  workers/
    ingestion/           Stage 1 experience ingestion worker
    consolidation/       Stage 3 memory consolidation worker
    reinforcement/       Stage 9 reinforcement scoring worker
    pattern/             Operational pattern detection worker
    telemetry/           Telemetry ingestion worker

packages/
  core-types/            Shared types: ExperienceEvent, PolicyState, Goal
  kafka-bus/             Typed Kafka producers, consumers, topic registry, W3C trace propagation
  memory-opensearch/     Hybrid retrieval client and OpenSearch schema support
  memory-objectstore/    Episodic truth-layer client for S3-compatible storage
  telemetry-otel/        cog.* semantic conventions and OTLP bootstrap
  policy-engine/         Drift, clamping, reward propagation
  agents/                Planner, critic, executor, memory, world-model agents
  consolidation-engine/  Replay, clustering, abstraction, decay
  reinforcement-engine/  Survival scoring, policy voting, identity influence
  affect-engine/         Runtime modulation signals for reward and stability
  attention-engine/      Salience routing and working-memory budget
  temporal-engine/       Urgency gradients and multi-timescale planning

infra/
  aiven/                 Terraform for Kafka, OpenSearch, PostgreSQL, ClickHouse on Aiven
  k8s/                   Kubernetes manifests and KEDA scalers
  opensearch/            Index templates and ISM policies
  kafka/                 Topic and ACL declarations

docs/
  architecture/          Architecture deep dives and stage inventory
  api/                     OpenAPI specification for the HTTP surface
  strategy/                OSS, partnership, and deployment strategy
  glossary.md              Canonical terminology
```

## Design Principles

- **Experience over data.** Every input is a structured event carrying context, embedding, and a reward signal, not a raw log entry.
- **Memory is selection, not storage.** OpenSearch is the associative retrieval layer; object storage is the immutable episodic truth layer. Consolidation decides what remains active.
- **Cognition under scarcity.** Compute budgets, attentional quotas, and forgetting mechanisms prevent unbounded accumulation.
- **Adaptation with constraints.** The architecture evolves policies within a constitutional invariant layer.
- **Engineering-first docs.** Architecture notes and inventory stay aligned with runtime behavior.

## Quick Start

### Prerequisites

- Node.js >= 22
- pnpm >= 10
- Docker for local OpenSearch and Kafka via testcontainers
- An Aiven account for production deployment, see `infra/aiven/`

### Install

```bash
pnpm install
```

### Build all packages

```bash
pnpm build
```

### Run tests

```bash
pnpm test
```

### Stage 1 Ingestion Worker

```bash
cp apps/workers/ingestion/.env.example apps/workers/ingestion/.env
# Fill in KAFKA_BROKERS, OPENSEARCH_URL, S3_BUCKET, OPENAI_API_KEY, or compatible embedding endpoint.
pnpm --filter @cognitive-substrate/ingestion-worker start
```

### Cognitive Workbench UI

Start the API/BFF and web app alongside the backend workers:

```bash
cp apps/api/.env.example apps/api/.env
# Fill in KAFKA_BROKERS and OPENSEARCH_URL, using the same values as the workers.
pnpm --filter @cognitive-substrate/api build && pnpm --filter @cognitive-substrate/api start

# In another terminal:
pnpm --filter @cognitive-substrate/web dev
# Open http://localhost:3000
```

The workbench opens a session, accepts messages, and streams cognitive-loop responses via SSE. Memory context and pipeline trace panels update in real time.

## Documentation

- `docs/architecture/`: infrastructure, schema, runtime design, and `inventory.md`
- `docs/api/openapi.yaml`: HTTP API surface
- `docs/glossary.md`: canonical terminology
- `docs/strategy/`: OSS, partnership, and deployment strategy notes

## Reference Deployment On Aiven

Production deployment targets Aiven managed services:

| Service | Role |
|---------|------|
| Aiven for Apache Kafka | Cognitive event bus |
| Aiven for OpenSearch | Associative memory layer and operational pattern library |
| Aiven for ClickHouse | Cognition observability warehouse and temporal telemetry substrate |
| Aiven for PostgreSQL | Relational coordination store |
| S3-compatible object storage | Episodic truth archive |

See `infra/aiven/` and `docs/architecture/aiven-deployment.md` for deployment details.

## License

Apache 2.0, see [LICENSE](LICENSE).
