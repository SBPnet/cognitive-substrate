# Stage 37: Real Telemetry as Operational Memory

*This article records the first hosted experiment in which Cognitive Substrate converted live infrastructure telemetry into embedded operational memory and used that memory inside the normal workbench response path.*

This article is an operational-memory epilogue to the sequence that begins with [Stage 30: Operational Primitives](article-31-operational-intelligence.md), passes through [Stage 32: Telemetry Ingestion Worker](article-33-telemetry-ingestion.md), and depends on the memory substrate introduced in [Stage 1: Experience Ingestion](article-01-experience-ingestion.md) and [Stage 35: OpenSearch ML Inference Nodes](article-04-opensearch-ml-inference.md).

Diagram source: [`docs/diagrams/article-37-real-telemetry-memory.mmd`](../diagrams/article-37-real-telemetry-memory.mmd).

## From deployment to learning signal

The day began as a deployment exercise and ended as a definition of success for the project. The initial objective was practical: run the Cognitive Substrate stack on managed infrastructure, ingest live Aiven metadata, metrics, and logs, and make those signals available to the workbench. The deeper requirement emerged during implementation. A system that merely exposes endpoints for operational questions has not demonstrated cognitive memory. It has demonstrated a dashboard or a query API. Cognitive Substrate requires a stricter test: operational experience must enter the same event stream as other experience, be embedded into memory, and later influence ordinary reasoning.

That distinction shaped the final experiment. The workbench question was deliberately simple: `what is the busiest service?` A direct endpoint could answer this with a short aggregation over metrics. That approach was rejected because it would bypass the memory substrate. The successful path required a live telemetry stream, compact operational summaries, Vertex embeddings, OpenSearch indexing, query embeddings in the orchestrator, retrieval during cognitive processing, and a response that surfaced the retrieved memory rather than a special-purpose answer.

The result was not merely a new feature. It was a working success criterion for the architecture. A telemetry observation became an `ExperienceEvent`; the ingestion worker embedded it using Vertex; OpenSearch stored it as a memory; the orchestrator embedded the later question using the same provider; retrieval found the relevant operational observation; and the workbench stream included a response grounded in that retrieved memory. The system crossed from operational monitoring into operational experience.

## Hosted stack

The hosted experiment used Aiven application services for the API, web workbench, orchestrator, ingestion worker, consolidation worker, and Aiven collector. Managed Aiven Kafka carried the event streams. Managed Aiven OpenSearch stored cognitive indexes, including `experience_events`. The Aiven collector polled project services and emitted raw telemetry to Kafka topics such as `telemetry.metrics.raw`, `telemetry.logs.raw`, and `telemetry.metadata.raw`.

Several deployment details mattered. Kafka topics had to be created programmatically because applications could start before all topics existed. Dockerfiles had to respect the monorepo layout so package builds occurred in dependency order and runtime containers contained the relevant application directories. OpenSearch vector schema settings had to use the `faiss` engine, since the older `nmslib` engine was not compatible with the target OpenSearch runtime. These were operational fixes, but they were also architectural hygiene. A cognitive memory system cannot evaluate learning behavior while the infrastructure layer is still nondeterministic.

The hosted services were configured with Kafka and OpenSearch credentials through Aiven service integrations. The first embedding experiment retained `OBJECT_STORE_PROVIDER=noop` because the immediate success signal depended on vector memory retrieval, not durable object storage. This was a deliberate constraint. The experiment isolated the learning effect to OpenSearch memory and avoided introducing a second storage migration at the same time.

## Real embeddings

The first major implementation change was Vertex authentication. The ingestion worker already had a Vertex embedding client, but it obtained access tokens by shelling out to `gcloud auth application-default print-access-token`. That works on a developer machine with local Application Default Credentials, but it does not work inside hosted application containers where the `gcloud` CLI and local credential files are absent.

The embedding client was extended to support `GOOGLE_APPLICATION_CREDENTIALS_JSON`. The hosted path parses the JSON credential, supports service-account JWT token exchange, and also supports authorized-user refresh-token exchange for local and short-lived experiments. Token responses are cached until near expiry. If the JSON secret is absent, the client preserves the previous local ADC behavior through `gcloud`. This preserved developer ergonomics while making the hosted path viable.

The orchestrator required a parallel correction. Before this work, retrieval queries used a zero-vector query embedder. That meant memories written with real Vertex vectors would not be queried in the same vector space. The orchestrator now selects its query embedder from environment variables, matching the ingestion worker: `EMBEDDING_PROVIDER=stub` retains the smoke-test path, while `EMBEDDING_PROVIDER=vertex` uses the Gemini embedding model and the same credential mechanism. This alignment is essential. A memory index built from real embeddings can only be evaluated fairly when the query path uses the same embedding model and dimensionality.

The hosted configuration was then updated for ingestion and orchestrator with `EMBEDDING_PROVIDER=vertex`, `EMBEDDING_DIMENSION=1536`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `VERTEX_EMBED_MODEL=gemini-embedding-001`, and the credential JSON secret. The first attempt exposed a practical hosted-env constraint: Aiven application environment values reject multiline strings. The credential JSON therefore had to be compacted into a single-line JSON value before being stored as a secret. The Google project identifier also had to come from the credential's quota project rather than the Aiven project name. This corrected the Vertex API target.

## Telemetry-to-experience bridge

Implementation note: the telemetry-to-experience bridge is now wired through the telemetry worker when `TELEMETRY_EXPERIENCE_ENABLED=true`. The bridge remains configuration-gated, so deployments must enable that flag before raw telemetry summaries enter the normal `ExperienceEvent` memory path.

The plan initially considered a separate telemetry summary worker. That design was intentionally reduced. The existing telemetry worker already owned the OTEL-native path from raw telemetry into operational primitive streams and ClickHouse. Creating another worker would have duplicated ownership of telemetry semantics. The better design was to extend the existing worker into a telemetry-to-experience bridge.

The telemetry worker now consumes all three raw telemetry topics: `telemetry.metrics.raw`, `telemetry.logs.raw`, and `telemetry.metadata.raw`. It still preserves the existing metrics pipeline when ClickHouse is configured. ClickHouse can also be disabled, in which case the worker remains useful as an operational experience publisher. This matters for experiments where the goal is memory retrieval rather than analytical storage.

The bridge groups telemetry by service within a time window. It counts metric records, log records, and metadata records, tracks observed metric names, ranks services by total telemetry volume, and constructs a compact semantic summary. The summary is emitted as an `ExperienceEvent` with type `environmental_observation`. Its tags include `aiven_telemetry`, `operational_summary`, `busiest_service`, a service tag, and a service-type tag. The structured payload records the window, ranked services, busiest service, estimated token count, and estimated embedding cost.

The summary text is intentionally semantic rather than a raw dump. A representative memory states that, during a specific observation window, a service was the busiest observed service with a count of telemetry records, broken down by metrics, logs, and metadata. It also lists the top services and the primary metric names observed for the busiest service. This is enough for retrieval and explanation without flooding the memory index with raw metric payloads.

The cost estimate uses the initial public estimate for `gemini-embedding-001`: approximately `$0.15 / 1M input tokens`. The token count is estimated from summary length, then converted to an approximate dollar value. This is deliberately simple but visible. The system records enough cost metadata to reason about whether summaries are too frequent or too verbose.

## Experiment isolation

Before the learning-effect run, OpenSearch memory indexes were reset. This prevented old smoke-test memories, especially zero-vector memories, from contaminating retrieval quality. Mixing stub vectors and real vectors would make the before and after comparison ambiguous. A clean index set created a sharper evaluation: before telemetry summaries, the question should retrieve nothing useful; after telemetry summaries, the same question should retrieve operational memory.

The before run asked the workbench API the target question through the existing session and message route. The response was generic. It did not name a service, did not cite an observation window, and did not explain a signal. That was the expected baseline. The system had no relevant operational memory to retrieve.

The after run started local updated workers against hosted Kafka and hosted OpenSearch so the new code path could be exercised before a GitHub-backed Aiven rebuild. The Aiven collector continued publishing raw telemetry. The updated telemetry worker produced operational summaries. The ingestion worker embedded those summaries with Vertex and indexed them in `experience_events`. The orchestrator processed the user question with Vertex query embeddings and retrieved relevant memories.

The strongest after response named `cs-aiven-kafka-20260509` as the busiest observed service. It cited an observation window from `2026-05-09T05:12:58.569Z` to `2026-05-09T05:13:29.170Z`. It explained the signal as telemetry volume: `3298` telemetry records, including `3285` metrics, `13` logs, and `0` metadata updates. It listed the next ranked services: OpenSearch, API, consolidation, and ingestion. This satisfied the core success definition. The answer emerged from the normal workbench message flow, not from a dedicated operational endpoint.

## Reasoning behavior

The experiment also exposed an important property of the current reasoning layer. The multi-agent runtime can retrieve the right memory while still allowing a non-memory agent to win arbitration. In one run, the critic or metacognition response won even though the memory agent had access to operational evidence. This was not a telemetry failure. It was an arbitration and proposal-quality issue.

The memory agent was refined so that, when a busiest-service question is asked and relevant memories exist, it proposes a response using the retrieved operational memory. Its confidence increases and its risk score decreases for this case, allowing memory-grounded answers to win arbitration more often. A further refinement was required because the current user question can itself become a recently indexed memory. The memory agent now prefers summaries containing `Aiven telemetry summary` and avoids echoing the current prompt when a more useful operational summary is available.

This lesson is significant. Retrieval quality is necessary but insufficient. A cognitive loop must also preserve the path from retrieval to answer selection. If arbitration rewards generic reflective responses more than grounded memory responses, the system can appear ignorant even when the correct memory was retrieved. The response policy must therefore distinguish between evidence-bearing memories and generic agent behavior.

## What the project learned

The most important lesson is that success should be defined as an observable cognitive effect. A telemetry collector, an embedding client, and an API route are components. The experiment succeeded only when a later question changed because prior operational experience existed in memory. This framing prevents implementation from drifting into a collection of dashboards and service endpoints.

The second lesson is that real embeddings change the evaluation surface. Stub vectors are useful for smoke tests because they keep the pipeline deterministic, but they cannot evaluate semantic retrieval. Once Vertex embeddings were introduced, both document and query paths had to use the same provider. The index also had to be clean. Without these constraints, retrieval results would be difficult to interpret.

The third lesson is that operational memory needs compression. Raw telemetry is too noisy for episodic memory. Compact summaries work better because they preserve the semantic facts needed for later questions: service name, window, volume, signal type, and ranking. The raw telemetry stream remains valuable for analysis, but memory should store operational meaning rather than every sample.

The fourth lesson is that cost visibility belongs in the memory itself. Embedding cost is small for compact summaries, but it becomes material when summaries are frequent or verbose. Recording estimated token count and cost in each summary makes retrieval experiments accountable. It also creates a future path for adaptive summarization policies, where summary frequency or detail can respond to budget pressure.

The fifth lesson is that hosted infrastructure uncovers integration constraints that local tests miss. Multiline secrets, Docker context assumptions, Kafka topic timing, vector engine compatibility, and service credential injection all affected the path to evidence. These details are not incidental. For a persistent memory system, operational reliability is part of the cognitive substrate.

## Shutdown state

After the experiment, the local worker processes were stopped and the hosted Cognitive Substrate Aiven services were powered off, including the application services, Kafka, and OpenSearch. The shutdown prevents unnecessary test spend while preserving the code and written evidence for the next deployment pass.

## Artifacts

**Code paths changed:** `apps/workers/ingestion/src/embedder.ts`, `apps/orchestrator/src/embedder.ts`, `apps/orchestrator/src/worker.ts`, `apps/workers/telemetry/src/worker.ts`, `apps/workers/telemetry/src/experience-bridge.ts`, `apps/workers/ingestion/src/pipeline.ts`, and `packages/agents/src/specialized-agents.ts`.

**Validation performed:** affected package typechecks passed for ingestion, orchestrator, and telemetry. The telemetry experience bridge contract passed. Hosted OpenSearch memory indexes were reset and recreated with the current schema. The before and after workbench evaluations showed the transition from a generic response to a memory-grounded operational answer.

**Remaining engineering work:** the updated code path should be pushed and rebuilt through the GitHub-backed Aiven application services. The hosted telemetry worker should be deployed as a first-class Aiven application if long-running telemetry-to-experience conversion is required without local workers. Durable object storage should be promoted after the OpenSearch retrieval effect remains stable across repeated runs.

**Interpretation:** the experiment demonstrated that real operational telemetry can become retrievable cognitive memory. The strongest result was not the busiest-service answer itself. The stronger result was that the answer flowed through the same event, embedding, memory, retrieval, reasoning, and response path used by the rest of the workbench.

**Series placement:** this experiment extends [Stage 36: Intelligence Transfer](article-36-intelligence-transfer.md) by showing the first hosted telemetry-to-memory path. It does not yet prove general transfer quality; it demonstrates that live operational observations can enter the substrate and later affect a normal workbench answer.
