# Cognitive Substrate

This repo is my workbench for an idea I keep coming back to: most "AI memory"
systems treat memory as a bag of vectors bolted onto a chat loop. I want to see
what happens when memory, retrieval, salience, reinforcement, and observability
are first-class infrastructure instead. Closer to how a database or a message
bus is infrastructure: opinionated, durable, and operating below the agent.

Cognitive Substrate is the long-form attempt at building that. TypeScript
services on Kafka and OpenSearch, with a research paper and per-stage articles
written alongside the code so the design and the implementation can keep each
other honest.

It is early. Stage 1 (experience ingestion) is implemented end to end. The
later stages exist as package skeletons, architecture notes, and draft
articles. The roadmap in `docs/roadmap.md` is the source of truth for what is
actually wired up versus what is still on paper.

## Why "substrate" and not "agent framework"

There are already a lot of agent frameworks. They tend to be thin wrappers
around an LLM with a prompt-shaped notion of memory. The bet here is that the
interesting failure modes of long-running cognitive systems (drift, forgetting,
contradiction, attention starvation, reward hacking, identity collapse) live
underneath the prompt layer, in the substrate that decides what gets remembered,
what gets retrieved, and what is allowed to change.

So the design treats those questions as infrastructure problems:

- **Experience over data.** Inputs are structured events with context,
  embedding, and a reward signal. Not log lines.
- **Memory is selection.** OpenSearch is the associative retrieval layer,
  object storage is the immutable episodic record, and a consolidation worker
  decides what stays active.
- **Cognition under scarcity.** Compute budgets, attentional quotas, and
  forgetting are part of the model, not afterthoughts.
- **Bounded adaptation.** Policies can drift, but inside a constitutional
  invariant layer with audit trails.
- **Code and writing together.** Every implementation stage ships with a
  companion article. If a claim cannot be written down clearly, it probably
  is not built clearly either.

The companion claim about cognition is more modest than the directory names
suggest. Biological terms (dopamine, salience, narrative selfhood) are used as
computational analogies for naming concepts. They are not claims of biological
equivalence, sentience, or AGI.

## What is actually working

| Stage | Status | Notes |
|-------|--------|-------|
| 1. Experience ingestion | Implemented | Kafka consumer, embedding, OpenSearch index, object-store write, downstream emit. Has a runnable companion demo under `docs/articles/companions/article-01-experience-ingestion/`. |
| 2. Memory retrieval | Skeleton | Hybrid retrieval client exists, full policy-weighted query path is in progress. |
| 3. Consolidation | Skeleton | Worker scaffolded, replay/abstraction logic not implemented. |
| 4-29. Everything else | Documented | Package directories, architecture notes, and draft articles exist. Code is mostly stubs. |

If a package directory exists but the corresponding stage table entry above
does not say "Implemented", treat it as a design surface, not a working
component.

## Repository layout

```text
apps/
  orchestrator/          Cognitive runtime entrypoint
  api/                   API/BFF between the web UI and Kafka/OpenSearch
  web/                   Cognitive workbench (Next.js)
  workers/
    ingestion/           Stage 1: experience ingestion
    consolidation/       Stage 3: memory consolidation
    reinforcement/       Stage 9: reinforcement scoring
    pattern/             Operational pattern detection
    telemetry/           Telemetry ingestion
    aiven-collector/     Pull service metrics from Aiven into the pipeline

packages/
  core-types/            Shared event and policy types
  kafka-bus/             Typed producers, consumers, topic registry, W3C trace propagation
  memory-opensearch/     Hybrid BM25 + k-NN client, schema helpers
  memory-objectstore/    S3-compatible episodic store
  telemetry-otel/        cog.* semantic conventions and OTLP bootstrap
  policy-engine/         Drift, clamping, reward propagation
  agents/                Planner, critic, executor, memory, world-model agents
  consolidation-engine/  Replay, clustering, abstraction, decay
  reinforcement-engine/  Survival scoring, policy voting, identity influence
  affect-engine/         Runtime modulation signals
  attention-engine/      Salience routing and working-memory budget
  temporal-engine/       Urgency gradients and multi-timescale planning
  ... (more engines under packages/, mostly skeletons for later stages)

infra/
  aiven/                 Terraform for Kafka, OpenSearch, PostgreSQL, ClickHouse on Aiven
  k8s/                   Kubernetes manifests and KEDA scalers
  opensearch/            Index templates and ISM policies
  kafka/                 Topic and ACL declarations

docs/
  paper/                 Research paper chapters
  articles/              One publishable article per stage
  diagrams/              Mermaid sources, with PNG/SVG exports next to articles
  architecture/          Architecture deep dives
  reviews/               Project reviews and audits
  strategy/              OSS, partnership, and commercial strategy notes
  style-guide.md         Editorial rules for everything under docs/
  glossary.md            Canonical terminology
  roadmap.md             Stage-by-stage plan with dependencies
```

## Running it

### Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- Docker (for the local OpenSearch + Kafka smoke stack)
- An Aiven account if you want to point at managed services instead of
  local containers

### Install and build

```bash
pnpm install
pnpm build
pnpm test
```

### Smoke checks

There are two layers of smoke coverage. They double as the quickest way to
verify a clean checkout:

```bash
pnpm smoke:packages   # build, typecheck, unit tests, package entrypoint imports
pnpm smoke:deep       # spins up local services and runs end-to-end probes
```

The deep smoke flow is the one that catches "I forgot to wire that topic"
mistakes. If you change a worker, package, Kafka topic, or storage schema,
update `scripts/smoke/deep-smoke.ts` along with it.

### Stage 1: ingestion worker

```bash
cp apps/workers/ingestion/.env.example apps/workers/ingestion/.env
# Set KAFKA_BROKERS, OPENSEARCH_URL, S3_BUCKET, and an embedding endpoint
# (OpenAI-compatible by default).
pnpm --filter @cognitive-substrate/ingestion-worker start
```

### Cognitive workbench UI

The workbench is a Next.js app that opens a session, sends messages, and
streams the cognitive-loop response over SSE while showing the retrieved
memory context and pipeline trace. It depends on the API/BFF and the workers
being up.

```bash
cp apps/api/.env.example apps/api/.env
# Use the same KAFKA_BROKERS and OPENSEARCH_URL as the workers.
pnpm --filter @cognitive-substrate/api build
pnpm --filter @cognitive-substrate/api start

# In another terminal:
pnpm --filter @cognitive-substrate/web dev
# http://localhost:3000
```

## Documentation worth reading first

If you want the design rationale, start here:

- `docs/roadmap.md` for the stage list and what depends on what.
- `docs/paper/` for the research paper chapters (in progress).
- `docs/articles/index.md` for the public reading order of the per-stage
  articles.
- `docs/architecture/` for infrastructure deep dives, especially
  `aiven-deployment.md`, `kafka-pipeline.md`, and `opensearch-schema.md`.
- `docs/glossary.md` if a term in the code or articles feels overloaded.

## Reference deployment on Aiven

The intended production target is a set of Aiven managed services. Local
development uses Docker containers with the same shape.

| Service                       | Role                                                             |
|-------------------------------|------------------------------------------------------------------|
| Aiven for Apache Kafka        | Cognitive event bus                                              |
| Aiven for OpenSearch          | Associative memory and operational pattern library               |
| Aiven for ClickHouse          | Cognition observability warehouse                                |
| Aiven for PostgreSQL          | Relational coordination store                                    |
| S3-compatible object storage  | Episodic truth archive                                           |

Terraform lives in `infra/aiven/`. Architectural notes live in
`docs/architecture/aiven-deployment.md`.

## Contributing

Issues and discussion are welcome. Code contributions are welcome with one
caveat: see the license. This is not Apache 2.0. It is intentionally limited
to noncommercial and educational use while the design is still moving.

If you are sending a PR, the practical bar is:

- Keep package boundaries clean. Engines do not import workers.
- Update `scripts/smoke/deep-smoke.ts` if you change a runtime flow.
- Add tests, or be explicit in the PR about what is not tested and why.

## License

PolyForm Noncommercial 1.0.0. See [LICENSE](LICENSE).

In short: research, study, teaching, hobby projects, nonprofits, and public
institutions can use, modify, and redistribute the code freely. Commercial use
is reserved. The license is not a finished decision. If something here turns
out to be useful, the project may relicense or dual-license later. Until then,
the noncommercial restriction is deliberate.
