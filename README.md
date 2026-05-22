# cognitive-substrate

TypeScript monorepo implementing a persistent, learnable cognitive memory substrate — memory, retrieval, salience, reinforcement, and observability as first-class infrastructure rather than an afterthought bolted onto a chat loop.

## Packages

| Package | Description |
|---------|-------------|
| `core-types` | Shared types: `ExperienceEvent`, `MemoryRecord`, `OperationalSignal`, policy vectors |
| `memory-opensearch` | OpenSearch client, index schemas, BM25 + k-NN retrieval helpers |
| `memory-objectstore` | S3-compatible object store archive for raw experience events |
| `retrieval-engine` | Attention-weighted retrieval with session-relative novelty and graph augmentation |
| `attention-engine` | Computes salience scores blending importance, novelty, and recency |
| `reinforcement-engine` | Hebbian compounding via retrieval-count bonus; writes `retrieval_priority` |
| `decay-engine` | Temporal decay projection; per-epoch rate scaling |
| `consolidation-engine` | Background re-consolidation: periodic boost for high-priority memories |
| `policy-engine` | Stateful policy vector updated from reinforcement signal; InMemoryPolicyStore |
| `constitution-engine` | Constraint evaluation against constitutional rules |
| `world-model` | Structured world-state graph updated from experience events |
| `causal-engine` | Structural causal model inference and counterfactual simulation |
| `narrative-engine` | Narrative thread construction from episodic memory sequences |
| `metacog-engine` | Meta-cognition: monitoring and adjusting cognitive loop parameters |
| `affect-engine` | Affective state modulation from experience valence |
| `curiosity-engine` | Novelty-driven exploration weighting |
| `social-engine` | Multi-agent interaction and reputation tracking |
| `temporal-engine` | Temporal indexing, windowing, and sequence alignment |
| `grounding-engine` | Perceptual grounding of symbolic memory to sensory context |
| `development-engine` | Developmental stage transitions and capability unlocking |
| `dream-engine` | Offline consolidation and memory replay |
| `abstraction-engine` | Hierarchical abstraction over episodic clusters |
| `budget-engine` | Cognitive resource budgeting and prioritisation |
| `agents` | Cognitive loop session and agent runtime primitives |
| `plugin-loader` | Runtime plugin loading for ingest mappers, reasoning engines, and tool executors |
| `tool-executor` | Built-in and MCP-backed ToolExecutor implementations (WebFetch, MemorySearch, WriteExperience) |
| `kafka-bus` | Typed Kafka producers, consumers, topic registry, and trace propagation |
| `ingest-worker` | Kafka consumer mapping TelemetryEvents to ExperienceEvents and indexing into OpenSearch |
| `clickhouse-telemetry` | ClickHouse telemetry sink for operational metrics |
| `telemetry-otel` | OpenTelemetry instrumentation |
| `aiven-client` | Aiven platform client utilities |
| `experiment-corpus` | Fixed-replay corpus and experiment harness (Experiments 1–44) |

## Getting started

```bash
pnpm install
pnpm build
```

Requires Node 22+, pnpm 10+. A running OpenSearch instance is needed for retrieval and reinforcement experiments. Container images: Dockerfiles under `apps/`; thor stack in `docker-compose.app.yml`; Dashboards assets in `deploy/opensearch-dashboards/`.

## Experiments

`packages/experiment-corpus` contains a numbered experiment series validating substrate behaviour end-to-end. Results are in `packages/experiment-corpus/results/`. The lab notebook is at `packages/experiment-corpus/src/experiments.md`.

```bash
OPENSEARCH_URL=http://localhost:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp44
```

## Documentation

See https://bigpines.net for my blog about this project. More detailed internal documentation to come.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You are free to use, modify, and distribute it, provided that any derivative works or services using this code also remain open source.

Commercial licensing is also available for companies that want to use this in proprietary products or services without AGPL obligations. Contact me for commercial licensing terms.