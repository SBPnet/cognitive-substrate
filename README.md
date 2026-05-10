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

It is early. Stage 1 (experience ingestion) has the strongest end-to-end
evidence: Kafka consumption, embedding, OpenSearch indexing, object-store
archive, downstream emission, and a runnable companion demo. Later stages range
from buildable TypeScript surfaces to architecture drafts and article outlines.
`docs/architecture/inventory.md` is the source of truth for implementation
status, and its status labels distinguish source availability from behavioral
validation.

## Vendor-neutral infrastructure

The core pipeline is bound to **protocols and URLs**, not to a single cloud or
vendor. You need Kafka-compatible brokers, OpenSearch-compatible HTTP APIs,
S3-compatible object storage, PostgreSQL for coordination, and ClickHouse (or
another warehouse if you adapt the telemetry writers). Services are reached
through ordinary connection strings and environment variables—there is no
proprietary substrate SDK in the main path.

For local development and CI, `docker-compose.smoke.yml` runs an OSS-shaped
stack (Apache Kafka in KRaft mode, OpenSearch, PostgreSQL, ClickHouse, MinIO,
plus optional helpers). For managed infrastructure, `infra/aiven/` is one
reference Terraform layout the maintainer uses for testing; the same code runs
elsewhere by swapping endpoints and credentials.

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

| Stage range | Evidence level | Notes |
|-------------|----------------|-------|
| Stage 1 | Runtime-demonstrated | Kafka consumer, embedding, OpenSearch index, object-store write, downstream emit, and runnable companion demo under `docs/articles/companions/article-01-experience-ingestion/`. |
| Stages 2-29 | Build-level implementation varies by package | TypeScript sources exist for many engines, but most stages still need deeper behavioral validation, architecture docs, and public article expansion. |
| Stages 30-36 | Build-level implementation with focused operational flows | Telemetry, primitive mapping, pattern detection, reinforcement feedback, and transfer surfaces are present, but transfer and recommendation quality remain hypotheses until replay and longitudinal evaluation are complete. |

If a package directory exists, treat that as evidence of a buildable design
surface, not proof of production readiness. The inventory separates source
presence from smoke coverage and behavioral evaluation.

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
    aiven-collector/     Optional collector for managed-service metrics APIs into the pipeline

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
  README.md              How portable runtime contracts map to example IaC
  aiven/                 Example Terraform for managed Kafka, OpenSearch, PostgreSQL, ClickHouse
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
  architecture/inventory.md
                          Stage-by-stage implementation status and doc debt
```

## Running it

### Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- Docker (for `docker-compose.smoke.yml`: full local stack used by smoke tests)
- Optional: any reachable Kafka, OpenSearch, PostgreSQL, ClickHouse, and
  S3-compatible storage matching your `.env` settings (managed or self-hosted)

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

- `docs/architecture/inventory.md` for the stage list, implementation status,
  evidence level, and missing architecture docs.
- `docs/paper/` for the research paper chapters (in progress).
- `docs/articles/index.md` for the public reading order of the per-stage
  articles.
- `docs/architecture/` for infrastructure deep dives, especially
  `inventory.md`, `operational-primitives.md`, `opensearch-ml-nodes.md`, and
  `clickhouse-telemetry.md`.
- `docs/glossary.md` if a term in the code or articles feels overloaded.

## Deployment options

Swap implementations by changing environment variables; the code paths stay the
same. The table below maps each concern to an interface, what the local compose
file provides, and examples of where else it can run.

| Concern | Interface | Local reference (`docker-compose.smoke.yml`) | Other examples |
|---------|-----------|---------------------------------------------|----------------|
| Event bus | Kafka API | `kafka` → `localhost:9092` | MSK, Confluent Cloud, Redpanda (Kafka-compatible), self-hosted Kafka |
| Associative memory | OpenSearch HTTP | `opensearch` → `localhost:9200` | Amazon OpenSearch Service, Elastic Cloud, self-hosted OpenSearch |
| Episodic archive | S3 API | MinIO → port `9001` | AWS S3, Cloudflare R2, MinIO, any S3-compatible endpoint |
| Telemetry warehouse | ClickHouse client / HTTP | `clickhouse` → `8123` / `9000` | ClickHouse Cloud, managed ClickHouse, self-hosted |
| Coordination | PostgreSQL | `postgres` → `localhost:5432` | RDS, Cloud SQL, self-hosted Postgres |

### Example Terraform (Aiven)

The maintainer keeps Terraform under `infra/aiven/` as **one** convenient
managed stack that matches the shape above. It is not the only valid
production layout. Architectural notes are currently split between
`infra/README.md`, `docs/architecture/inventory.md`, and the concrete Terraform
under `infra/aiven/`.

## Contributing

This project is maintained independently. It is not an official offering of any
employer unless explicitly stated elsewhere. Product and service names appear
only to identify compatible third-party implementations.

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
