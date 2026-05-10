# Glossary

This glossary defines project-specific terms and recurring infrastructure terminology used throughout `docs/`, `apps/`, and `packages/`.

## A

**Aiven**: A managed services platform used for production deployment of Kafka, OpenSearch, and PostgreSQL. See `docs/architecture/aiven-deployment.md`.

**Agent**: A specialized cognitive worker that produces a proposal, evaluation, prediction, or retrieval result under a common runtime contract. See `docs/architecture/agent-runtime.md`.

**Agent context**: The input bundle provided to an agent execution, typically including a session snapshot, retrieved memories, active goals, policy state, and the current input payload. See `docs/architecture/agent-runtime.md`.

**Agent orchestration runtime**: The execution layer that coordinates multi-agent cognition, shared context, scheduling, arbitration, and post-action consolidation. See `docs/architecture/agent-runtime.md`.

**Arbitration**: The process that compares agent proposals, scores candidates, resolves conflicts, and selects a final decision for execution. See `docs/architecture/agent-runtime.md`.

**Audit stream**: An immutable event stream intended to record state-changing events such as memory updates, policy updates, and self-modification outcomes. See `docs/architecture/kafka-pipeline.md`.

## C

**Cognitive bus**: The Kafka event fabric treated as the temporal coordination layer for asynchronous cognition. See `docs/architecture/kafka-pipeline.md`.

**Cognitive observability**: Observability focused on cognition as a distributed process, including memory retrieval, arbitration, policy drift, consolidation, and self-modification. See `docs/architecture/otel-observability.md`.

**Cognitive session**: A runtime-scoped state container that persists trace context, working memory references, policy snapshot, participating agents, and arbitration state. See `docs/architecture/agent-runtime.md`.

**Consolidation**: A batch-oriented pipeline stage that replays episodic events to produce semantic abstractions, reinforcement updates, and decay decisions. See `docs/architecture/kafka-pipeline.md` and `docs/architecture/agent-runtime.md`.

**Consolidation worker**: A worker responsible for executing consolidation tasks such as replay, clustering, summarization, abstraction generation, and decay scoring. See `docs/architecture/aiven-deployment.md`.

## D

**Decay**: A forgetting mechanism that reduces the weight, accessibility, or survival probability of low-utility memories over time. See `docs/architecture/kafka-pipeline.md` and `docs/architecture/opensearch-schema.md`.

**Derived source**: An OpenSearch feature used to reduce duplication between indexed vectors and source fields for embedding-heavy documents. See `docs/architecture/opensearch-schema.md`.

## E

**Embedding**: A vector representation of text or structured input used for similarity search and retrieval in the memory substrate. See `docs/architecture/opensearch-schema.md`.

**Enrichment**: A processing step that adds embeddings and metadata such as tags, importance scoring, and reward initialization to raw experience events. See `docs/architecture/kafka-pipeline.md`.

**Experience event**: The atomic unit of cognition representing perception, action, tool output, or observed outcome, captured with context, embedding, and evaluation metadata. In code, this is `ExperienceEvent`. See `packages/core-types/src/experience.ts` and `docs/architecture/kafka-pipeline.md`.

**Experience ingestion**: The pipeline stage that accepts incoming experiences and publishes them to the event bus for downstream enrichment, indexing, reasoning, and evaluation. See `docs/architecture/kafka-pipeline.md` and `docs/articles/article-01-experience-ingestion.md`.

## G

**Goal system**: The representation of long-horizon objectives, including hierarchy, priority, progress, and status, used to guide retrieval, planning, and arbitration. See `docs/architecture/opensearch-schema.md`.

## H

**Horizontal scaling**: A scaling property in which agent workers and pipeline components scale by increasing parallel replicas, typically via Kafka partitions and consumer groups. See `docs/architecture/agent-runtime.md`.

## I

**Identity state**: A persistent representation of behavioral tendencies such as curiosity, caution, verbosity, tool dependence, and stability over time. See `docs/architecture/opensearch-schema.md`.

**Identity drift**: The temporal evolution of identity state in response to reinforcement signals, experience history, and policy updates. See `docs/architecture/otel-observability.md`.

**Importance score**: A scalar used to prioritize retention, indexing, and consolidation of experiences or semantic memories. See `docs/architecture/opensearch-schema.md`.

## K

**KEDA**: Kubernetes-based event-driven autoscaling used to scale workers based on stream and workload signals. See `docs/architecture/aiven-deployment.md`.

## M

**Memory gateway**: The component that performs retrieval from the memory substrate and provides a normalized interface to the runtime and agents. See `docs/architecture/agent-runtime.md`.

**Memory indexing**: The step that writes searchable metadata and embeddings into OpenSearch, archives raw payloads in object storage, and emits indexing events on the bus. See `docs/architecture/kafka-pipeline.md`.

**Memory links**: Graph relationships between memories used to support multi-hop retrieval and structural navigation. In OpenSearch, these are stored in the `memory_links` index. See `docs/architecture/opensearch-schema.md`.

**Memory substrate**: The persistent storage and retrieval layer for cognition, primarily OpenSearch for associative retrieval plus object storage for immutable full-fidelity payloads. See `docs/architecture/opensearch-schema.md`.

## O

**Object storage truth layer**: The immutable archive for full experience payloads, referenced from indexed metadata via keys such as `object_storage_key`. See `docs/architecture/opensearch-schema.md` and `packages/core-types/src/experience.ts`.

**OpenSearch**: The associative memory store used for keyword and vector retrieval across experiences, semantic memories, policy state, agent activity, world-model predictions, goals, and identity. See `docs/architecture/opensearch-schema.md`.

**OpenTelemetry (OTEL)**: The observability framework used to instrument cognition as distributed traces, metrics, and logs with project-specific semantic conventions under the `cog.*` namespace. See `docs/architecture/otel-observability.md`.

## P

**Policy engine**: The subsystem that maintains adaptive behavioral weights and applies reward-driven updates that influence retrieval weighting, exploration, risk tolerance, and arbitration bias. See `docs/architecture/agent-runtime.md` and `docs/architecture/kafka-pipeline.md`.

**Policy drift**: The time-varying change in policy state due to reward signals, feedback, and reinforcement updates, typically published on `policy.updated`. See `docs/architecture/kafka-pipeline.md` and `docs/architecture/opensearch-schema.md`.

**PostgreSQL**: The relational coordination store used for state that benefits from relational constraints, including agent configuration, identity anchors, session state, and policy version history. See `docs/architecture/aiven-deployment.md`.

## R

**Redis**: The implementation substrate for working memory, used as an in-memory cache for short-lived cognitive state. See `docs/architecture/agent-runtime.md`.

**Reinforcement**: The process that computes reward signals and propagates reward-driven updates into policy and identity state. See `docs/architecture/kafka-pipeline.md`.

**Retrieval feedback**: A recorded signal evaluating the utility of specific retrieval results, used to improve future retrieval weighting. In OpenSearch, this is stored in the `retrieval_feedback` index. See `docs/architecture/opensearch-schema.md`.

## S

**Scheduler**: The component that controls agent execution order, parallelism, timeouts, prioritization, and retries. See `docs/architecture/agent-runtime.md`.

**Semantic memory**: Consolidated abstractions derived from episodic replay, stored for retrieval and generalization. In OpenSearch, this is the `memory_semantic` index. See `docs/architecture/opensearch-schema.md`.

**Session manager**: The runtime component responsible for lifecycle management of cognitive sessions. See `docs/architecture/agent-runtime.md`.

**Self-modification**: The controlled proposal, validation, and application of architecture or policy mutations produced by meta-cognitive mechanisms. See `docs/architecture/kafka-pipeline.md`.

## C (additions)

**ClickHouse**: The append-only analytical datastore used as the temporal telemetry intelligence layer. Stores raw metrics, logs, traces, cognitive events, and pattern outcomes from all monitored Aiven services. Optimised for aggregation-heavy time-series workloads at 1 000+ service scale. See `docs/architecture/clickhouse-telemetry.md`.

**Cognition topic tier**: The `cognition.*` Kafka namespace. Carries processed operational intelligence: `cognition.primitives`, `cognition.patterns`, `cognition.anomalies`, and `cognition.recommendations`. All topics in this tier use Diskless storage (KIP-1150) because minutes-level latency is acceptable and 90-day retention is required for reinforcement history. See `docs/architecture/kafka-pipeline.md`.

## D (additions)

**Diskless Topic**: A Kafka topic backed by object storage rather than broker-local disks, as defined by KIP-1150 (implemented by Aiven as Inkless Kafka). Brokers become stateless routing nodes for these topics. Suitable for high-volume append-only streams where object-storage latency (500 ms to 5 s) is acceptable and long retention is required at low cost. See `docs/architecture/kafka-pipeline.md`.

## O (additions)

**Operational Primitive**: A system-agnostic unit of distributed system behaviour that forms the basic vocabulary of the pattern library. Examples: `BACKPRESSURE_ACCUMULATION`, `LOAD_SKEW`, `TAIL_LATENCY_EXPANSION`. Operational primitives describe behavioural dynamics rather than vendor metrics, making learned patterns portable across different infrastructure environments. See `docs/architecture/operational-primitives.md`.

## P (additions)

**Pattern library**: The OpenSearch-backed store of system-agnostic operational patterns. Each pattern defines a `signature` (co-occurring primitives), `precursors` (early-warning primitives), `outcome` description, and ordered `interventions`. Confidence is updated by the reinforcement worker based on observed recommendation outcomes. See `docs/architecture/operational-primitives.md`.

## S (additions)

**System mapping**: An adapter definition that binds vendor-specific metric names to the operational primitive vocabulary. Expressed as a `SystemMapping` object in `packages/abstraction-engine/src/primitives/mapping-layer.ts`. When a system is onboarded, only the mapping changes; the pattern library and detection logic remain unchanged. See `docs/architecture/operational-primitives.md`.

## T

**Telemetry topic tier**: The `telemetry.*` Kafka namespace. Carries raw infrastructure telemetry: `telemetry.metrics.raw`, `telemetry.logs.raw`, `telemetry.traces.raw`, and the normalised derivative `telemetry.events.normalized`. All topics use Diskless storage (KIP-1150) because scrape intervals are 15 s or longer. See `docs/architecture/kafka-pipeline.md`.

**Terraform**: The infrastructure-as-code tool used to define and provision managed services, particularly under `infra/aiven/`. See `docs/architecture/aiven-deployment.md`.

**Trace context propagation**: The mechanism that preserves causality across distributed cognitive steps, typically using W3C trace context carried through Kafka message headers. See `docs/architecture/otel-observability.md`.

**Transfer layer**: The combination of the system mapping DSL and the pattern library that enables learned operational intelligence to be re-applied to a new infrastructure environment without retraining. When the system is pointed at a new environment, only a `SystemMapping` is required; the pattern worker immediately begins matching incoming primitives against the existing library. See `docs/architecture/operational-primitives.md`.

## W

**Working memory**: A short-lived store for active context such as recent memories, active plans, and unresolved contradictions, implemented in Redis or an in-process cache. See `docs/architecture/agent-runtime.md`.

**World model**: A predictive simulation subsystem that evaluates candidate actions prior to execution and emits risk and confidence estimates. See `docs/architecture/agent-runtime.md` and `docs/architecture/kafka-pipeline.md`.


## Cognitive Substrate Identity

**Cognitive Substrate**: A distributed cognitive infrastructure framework for persistent memory, adaptive retrieval, salience propagation, reinforcement-weighted cognition, and event-driven AI systems.

**Associative memory layer**: The OpenSearch-backed retrieval layer that stores searchable metadata, vectors, semantic abstractions, memory links, and retrieval feedback for active recall.

**Branching cognition**: A runtime model in which divergent lines of reasoning, interruptions, and competing contextual continuations are represented as traceable branches with lifecycle state.

**Cognitive event bus**: The Kafka event fabric that coordinates asynchronous cognition across ingestion, retrieval, arbitration, consolidation, telemetry, and reinforcement.

**Episodic truth layer**: The immutable object-storage archive for full-fidelity experience payloads and raw traces.

**Reinforcement-weighted retrieval**: Retrieval that combines lexical, vector, recency, salience, decay, and reward-history signals to select memories based on expected utility rather than similarity alone.

**Salience propagation**: The movement of priority signals across memory, attention, retrieval, consolidation, and arbitration surfaces.
