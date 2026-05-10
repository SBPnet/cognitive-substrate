# OpenSearch OSS Embedding Brief

## Purpose

This brief converts the current OpenSearch embedding research thread into a prompt-ready artifact for model selection, architecture review, and article drafting. The technical objective is a domain-agnostic cognitive substrate that begins with logs and metrics, then generalizes to documents, code, incidents, and future multimodal experience types.

The central design boundary is unchanged from the Stage 35 inference architecture: OpenSearch ML nodes should host embedding, sparse encoding, lightweight classification, and reranking workloads. Long-context reasoning and large generative models should remain external services connected through the orchestrator or ML Commons remote connectors.

This brief extends the Stage 35 reference architecture in `docs/architecture/opensearch-ml-nodes.md`. The architecture document describes a compact local ML Commons baseline; this strategy brief describes the evaluation and migration path for larger or newer embedding families. The intended sequence is external or application-side embeddings for early experiments, remote inference for model comparison, and local ML Commons deployment only after a winning model has compatible artifacts and measured latency.

## Copy-Paste Prompt

```text
Project context:
Cognitive Substrate is a distributed cognitive infrastructure framework for persistent memory, adaptive retrieval, salience propagation, reinforcement-weighted cognition, and event-driven AI systems. The system uses OpenSearch as an associative memory layer and ClickHouse as the analytical telemetry layer. Raw metrics, logs, and traces remain in ClickHouse. OpenSearch receives compressed cognitive artifacts such as incident summaries, pattern documents, memory records, and embeddings.

Task:
Evaluate ideal open-weight or open-source embedding options for self-managed OpenSearch OSS running on AWS. The first experiments use logs and metrics as the initial experience type, but the architecture must remain domain-agnostic. Future experience types may include documents, code, events, image-derived metadata, and pose or skeleton features.

Architecture constraints:
OpenSearch ML Commons should be treated as an embedding and reranking surface, not a general-purpose LLM host. Local OpenSearch model deployment should favor portable TorchScript or ONNX artifacts when practical. Larger, newer, or custom-serving models may run behind remote connectors on EC2, SageMaker, vLLM, Text Generation Inference, or another HTTP inference service. The recommendation should distinguish clearly between in-cluster local deployment and externally hosted inference.

Candidate model set:
Assess Qwen3-Embedding as the quality-first family, especially the 0.6B and 4B variants before considering 8B. Assess BGE-M3 as the hybrid retrieval candidate because it can support dense, sparse, and multi-vector retrieval patterns. Assess Nomic Embed Text v2 as an efficient multilingual baseline for high-volume telemetry experiments. Assess EmbeddingGemma 300M as a compact efficiency baseline, with explicit license review because Gemma model terms are not equivalent to a permissive open-source software license. Mention Jina Embeddings v3 only as an optional long-context or multilingual comparison if licensing and serving constraints fit the deployment.

Evaluation criteria:
Compare retrieval quality, cluster coherence, latency, throughput, memory footprint, vector dimension, index size, license suitability, OpenSearch integration complexity, AWS operating cost, and resilience to noisy telemetry. Include behavior on parsed log templates, enriched metric summaries, incident timelines, and natural-language diagnostic queries.

Experiment design:
Start with two vector representations per cognitive artifact: one quality-first embedding and one efficiency-first embedding. Keep BM25 available for lexical fallback. Add BGE-M3 or OpenSearch sparse encoding as a hybrid retrieval follow-up if dense-only retrieval misses identifiers, service names, error codes, or structured log tokens. Evaluate offline with labeled incident-style queries and clustering coherence. Evaluate online with index-time embedding latency, query-time embedding latency, k-NN latency, reranker latency, and cost per million embedded artifacts.

Expected output:
Architecture recommendation, evaluation plan, and staged implementation guidance.
```

## One-Paragraph Prompt

```text
Evaluate OSS and open-weight embedding models for a self-managed OpenSearch OSS cognitive memory layer on AWS. The system starts with logs and metrics but must remain domain-agnostic across future experiences such as documents, code, events, and multimodal metadata. Compare Qwen3-Embedding, BGE-M3, Nomic Embed Text v2, EmbeddingGemma 300M, and optional Jina candidates across retrieval quality, clustering utility, latency, throughput, vector dimension, license suitability, OpenSearch ML Commons compatibility, remote-connector feasibility, and AWS cost. Recommend a first experiment that stores at least one quality-first and one efficiency-first vector per cognitive artifact, preserves BM25 fallback, evaluates hybrid retrieval for identifiers and structured tokens, and keeps long-context reasoning outside OpenSearch.
```

## Recommended Starting Position

The first experiment should not standardize on a single model. A dual-track baseline gives the substrate a better chance of separating model quality from systems behavior:

- Quality-first track: `Qwen3-Embedding-0.6B` or `Qwen3-Embedding-4B`, depending on latency and serving cost.
- Efficiency-first track: `Nomic Embed Text v2` for a permissive, compact multilingual baseline.
- Hybrid follow-up: `BGE-M3` when lexical specificity, identifiers, and structured telemetry tokens need stronger recall than dense embeddings alone provide.
- Compact comparison: `EmbeddingGemma 300M` if memory footprint is the dominant constraint and license review accepts the Gemma terms.

This structure supports early testing without tying the substrate to telemetry. The same artifact can later receive additional vectors for code, document, image-derived, or pose-derived representations.

## OpenSearch Integration Pattern

OpenSearch should store semantic memory artifacts rather than raw telemetry streams. ClickHouse continues to answer high-volume temporal questions such as event frequency, rate changes, correlations, and incident windows. OpenSearch answers associative questions such as resemblance, precedent, likely remediation, and semantically related incidents.

The first index design should preserve separate vector fields per model family rather than projecting all models into one field. This keeps evaluation honest and allows model replacement without corrupting historical comparisons. Example field roles:

- `embedding_qwen`: quality-first dense semantic vector.
- `embedding_nomic`: efficiency-first dense semantic vector.
- `embedding_bge_m3`: optional dense hybrid candidate vector.
- `sparse_bge_m3` or OpenSearch sparse output: optional lexical-semantic sparse representation.

Local ML Commons deployment is appropriate when a model can be packaged as a supported TorchScript or ONNX artifact and meets latency targets on ML nodes. Remote connectors are appropriate when the model needs custom Hugging Face code, GPU serving, quantization, batching, or a runtime that OpenSearch should not host directly.

## Article Adaptation Map

Opening problem: telemetry systems often preserve what happened but fail to preserve what an event resembles. Raw logs and metrics can support dashboards, but cognitive recall requires compressed semantic artifacts that can be searched by meaning, precedent, and operational similarity.

Thesis: OpenSearch embeddings are the memory-adjacent inference layer for the substrate. The model choice should be evaluated as infrastructure, not as a one-off machine learning preference.

Running example: a latency increase, an error burst, and a deployment event are normalized into a cognitive artifact. ClickHouse keeps the raw time-series evidence. OpenSearch stores the summary, metadata, lexical fields, and multiple embeddings for later recall.

Architecture walkthrough: Stage 35 supplies ML node tiers for embeddings and reranking. The revised experiment adds a model selection ladder: Qwen for quality, Nomic for efficiency, BGE-M3 for hybrid retrieval, and a compact baseline when memory pressure dominates.

Design boundary: OpenSearch ML nodes are not large reasoning nodes. They should not host long-context chat models, custom native inference engines, or model runtimes that require unsupported kernels. Those workloads belong behind remote connectors or the orchestrator.

Evidence status: model recommendations remain design hypotheses until measured on repository-specific telemetry artifacts. Required evidence includes retrieval relevance, cluster coherence, indexing latency, query latency, reranking latency, and cost per million embedded artifacts.

Forward transition: once the embedding substrate is measurable, the next article can connect retrieval quality to reinforcement feedback, pattern promotion, and cross-environment intelligence transfer.

## Decision Matrix Template

- `Qwen3-Embedding-0.6B` or `Qwen3-Embedding-4B`: quality-first dense recall. Strength is general retrieval and long context. Risk is higher serving cost than compact models. First test is incident query recall and clustering.
- `BGE-M3`: hybrid retrieval. Strength is dense, sparse, and multi-vector retrieval modes. Risk is more complex indexing and query fusion. First test is identifier-heavy telemetry search.
- `Nomic Embed Text v2`: efficient dense baseline. Strength is compact multilingual embedding with a permissive license. Risk is shorter context than Qwen and BGE-M3. First test is high-volume artifact ingestion.
- `EmbeddingGemma 300M`: compact comparison. Strength is low memory footprint and flexible dimensions. Risk is Gemma terms requiring separate license review. First test is a low-cost ML node or edge-style baseline.
- `Jina Embeddings v3`: optional comparison. Strength is long context and task adapters. Risk is license and serving review. First test is a long artifact or multilingual comparison.

## Measurement Checklist

- Retrieval: labeled incident-style natural-language queries, top-k recall, mean reciprocal rank, and reranker lift.
- Clustering: silhouette score, manual cluster coherence, and recurrence detection across service versions.
- Systems: model load time, index-time embedding latency, query-time embedding latency, k-NN latency, reranker latency, and ML node saturation.
- Cost: vector storage per million artifacts, inference cost per million artifacts, and remote connector cost when applicable.
- Robustness: schema drift, noisy log variables, sparse service metadata, multilingual labels, and rare error identifiers.

## Implemented Recommendation

The initial OpenSearch embedding program should use a dual-baseline deployment rather than a single canonical model. The recommended first pair is `Qwen3-Embedding-0.6B` for quality-first dense recall and `Nomic Embed Text v2` for efficient high-volume comparison. This pair creates an immediate contrast between a stronger general retrieval family and a compact multilingual baseline with a permissive license profile.

`Qwen3-Embedding-4B` should remain the quality escalation path after the 0.6B model establishes useful recall. The 4B model is a better candidate for article and benchmark claims if latency and serving cost remain acceptable. `Qwen3-Embedding-8B` should remain outside the first deployment because its value is more likely to appear in difficult multilingual or long-context retrieval tests than in the first logs and metrics baseline.

`BGE-M3` should be treated as the first hybrid retrieval addition, not as the first mandatory baseline. Its dense, sparse, and multi-vector modes are useful for operational telemetry because service names, error codes, region identifiers, version strings, and metric names often carry meaning that dense embeddings can blur. The added query and indexing complexity is justified only after dense-only tests expose lexical recall gaps.

`EmbeddingGemma 300M` is a compact comparison candidate for memory-constrained ML nodes and high-throughput ingestion experiments. It should not be adopted as the default until license review confirms that Gemma terms fit the project distribution model. `Jina Embeddings v3` should remain an optional comparison for long-context or multilingual artifacts after the first benchmark harness exists.

## First Deployment

The first deployment should embed compressed cognitive artifacts, not raw telemetry rows. A cognitive artifact can represent a parsed log pattern, metric anomaly summary, incident fragment, service health transition, or operator action. Each artifact should include enough structured context for retrieval without copying entire raw event windows into OpenSearch.

Recommended first artifact fields:

- `artifact_id`: stable identifier for the semantic artifact.
- `artifact_type`: one of `log_pattern`, `metric_anomaly`, `incident_fragment`, `deployment_event`, or `operator_action`.
- `environment`: deployment environment or tenant boundary.
- `service_id`: canonical service identifier.
- `service_type`: service family or runtime category.
- `timestamp`: artifact time anchor.
- `summary`: concise natural-language representation used for embedding.
- `normalized_text`: parsed template, metric description, or enriched diagnostic text.
- `structured_terms`: service names, metric names, error codes, regions, versions, and identifiers for lexical search.
- `source_refs`: references into ClickHouse or object storage for raw evidence.
- `embedding_qwen`: dense vector from the selected Qwen3 embedding model.
- `embedding_nomic`: dense vector from Nomic Embed Text v2.
- `embedding_bge_m3`: optional dense vector for the hybrid lane.
- `sparse_bge_m3`: optional sparse representation for hybrid retrieval.

The first model dimensions should be fixed per index generation. If `Qwen3-Embedding-0.6B` is used at 1024 dimensions and Nomic is used at 768 dimensions, those dimensions should be encoded into index mappings and index names. Dimension changes should create a new index generation rather than mutating the existing retrieval surface.

## AWS Serving Pattern

The first benchmark should prefer remote inference services connected to OpenSearch through ML Commons connectors or application-side inference calls. This reduces schedule risk from model conversion work and allows GPU, CPU, batching, and quantization experiments outside the OpenSearch cluster. Once a model wins a benchmark round, local ML Commons deployment can be evaluated for models that package cleanly as TorchScript or ONNX.

Recommended serving roles:

- OpenSearch data nodes: shard storage, k-NN retrieval, lexical retrieval, and metadata filtering.
- OpenSearch ML embedding nodes: local embedding only after the selected model has a compatible artifact and meets latency targets.
- OpenSearch ML reranker nodes: cross-encoder or reranker deployment after the initial recall benchmark is stable.
- EC2 or SageMaker inference endpoint: Qwen3, Nomic, or BGE-M3 serving during the evaluation phase.
- Orchestrator or ingestion worker: artifact construction, model routing, embedding writes, and fallback behavior.

The first infrastructure decision should optimize for observability rather than maximum throughput. Each embedding call should record model id, model version, vector dimension, input token count, latency, and failure mode. This metadata makes later retrieval results explainable and prevents silent model drift.

## OpenSearch Index Strategy

The first index generation should keep model vectors separate:

- `cognitive_artifacts_v1`: metadata, summary text, normalized text, structured lexical terms, and model-specific vectors.
- `cognitive_artifacts_eval_v1`: optional shadow index for experimental models or dimensions.
- `model_registry`: small metadata index recording model id, model family, vector dimension, serving path, license notes, and deployment status.

Separate vector fields preserve comparability. A single shared vector field would make mixed-model retrieval harder to interpret and would complicate index migration when the winning model changes.

The initial query path should use filtered retrieval before scoring. Environment, time range, service type, and artifact type filters should narrow the candidate population. After filtering, the retrieval engine should run one or more recall channels:

- BM25 over `summary`, `normalized_text`, and `structured_terms`.
- k-NN over `embedding_qwen`.
- k-NN over `embedding_nomic`.
- Optional sparse retrieval after BGE-M3 or OpenSearch sparse encoding is introduced.

Results should be combined with reciprocal rank fusion or another explicit score-fusion method. Fusion weights should remain configuration, not hidden constants, because the correct weighting will differ between incident recall, pattern discovery, and exploratory search.

## Query Strategy

The first query interface should support three retrieval modes:

- `quality`: Qwen dense retrieval plus BM25 fallback.
- `efficient`: Nomic dense retrieval plus BM25 fallback.
- `hybrid`: Qwen or Nomic dense retrieval, BM25, and optional BGE-M3 sparse retrieval.

The default mode for experiments should be `quality` for offline recall tests and `efficient` for throughput tests. The `hybrid` mode should become the default only if it improves identifier-heavy queries without unacceptable latency or index-size growth.

Reranking should be introduced after first-stage recall is measurable. A reranker cannot recover documents that recall never returns. The benchmark should therefore record both pre-rerank recall and post-rerank ordering quality.

## Evaluation Plan

The first benchmark should use a fixed telemetry corpus with a small but explicit relevance set. The corpus should include recurring incidents, benign noisy logs, metric anomalies, deployment windows, and normal service changes. Each artifact should retain a source reference to raw ClickHouse evidence so that retrieval results can be audited.

Offline retrieval tests should include:

- Natural-language incident queries, such as authentication latency increases, disk pressure, failed deploys, or regional error bursts.
- Identifier-heavy queries containing service names, error codes, metric names, or version strings.
- Cross-type queries that ask whether a metric anomaly resembles a prior log pattern or incident summary.
- Temporal holdout tests where retrieval must find precedent from older windows without leaking future labels.

Clustering tests should include:

- Recurring log pattern grouping.
- Metric anomaly family grouping.
- Incident fragment grouping by likely root cause.
- Separation tests for benign high-volume noise.

Operational tests should include:

- Embedding throughput per model.
- p50, p95, and p99 embedding latency.
- k-NN query latency under filtered and unfiltered searches.
- Vector storage growth per million artifacts.
- Failure handling when an inference endpoint is unavailable.

## Decision Thresholds

`Qwen3-Embedding-0.6B` should become the first quality default if it beats Nomic on incident recall and cluster coherence by a meaningful margin while staying within the indexing latency budget. `Qwen3-Embedding-4B` should replace it only if the benchmark demonstrates material retrieval gains that justify the increased serving cost.

`Nomic Embed Text v2` should become the first efficiency default if it provides acceptable recall at significantly lower latency or cost. It can also remain the ingestion default while Qwen is used for query-time expansion or selective re-embedding of important artifacts.

`BGE-M3` should enter the default path if hybrid retrieval improves identifier-heavy recall, reduces false semantic matches, or improves reranker candidate quality. If the benefit appears only in narrow cases, it should remain a specialized retrieval mode.

`EmbeddingGemma 300M` should advance only if its memory footprint or latency materially improves deployment feasibility and license review is acceptable. `Jina Embeddings v3` should advance only for a defined long-context or multilingual need.

## Risks

Model drift is the primary systems risk. Every vector should be tied to a model id, version, dimension, prompt format, and input field policy. Re-embedding should be treated as an index migration, not a background implementation detail.

Dense-only recall can miss operational identifiers. Hybrid search should remain available because telemetry often carries meaning in exact strings.

Remote inference can hide latency and cost variability. The evaluation harness should record endpoint saturation, queueing behavior, and cost per million artifacts.

Local ML Commons deployment can create operational coupling between search health and inference health. Dedicated ML nodes and explicit deployment plans reduce that risk, but production readiness still requires failure injection and backpressure tests.

Licensing can block otherwise attractive models. Each candidate requires an explicit license note before it becomes part of a public reference deployment.

## Staged Rollout

Stage 1 should build the benchmark corpus and dual-vector index. Ingestion should write `embedding_qwen` and `embedding_nomic` for each cognitive artifact, with BM25 fields preserved.

Stage 2 should run offline retrieval and clustering tests. The output should record model quality, latency, cost, and failure behavior in a repeatable report.

Stage 3 should add BGE-M3 or OpenSearch sparse encoding for identifier-heavy retrieval tests. This stage should compare dense-only search with hybrid search before adding reranking.

Stage 4 should add reranking over over-fetched candidates. This stage should measure whether reranking improves final ordering after recall quality is already sufficient.

Stage 5 should standardize the first production default. The standard should specify model family, vector dimension, serving path, index generation, fallback behavior, and re-embedding policy.

Stage 6 should adapt the article draft. The article should present the model choice as an infrastructure decision for memory quality, with benchmark evidence separated from design hypotheses.
