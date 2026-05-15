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
| `agents` | Agent runtime: debate, arbitration, multi-agent orchestration |
| `kafka-bus` | Kafka topic definitions, producer/consumer helpers |
| `clickhouse-telemetry` | ClickHouse telemetry sink for operational metrics |
| `telemetry-otel` | OpenTelemetry instrumentation |
| `aiven-client` | Aiven platform client utilities |
| `experiment-corpus` | Fixed-replay corpus and experiment harness (Experiments 1–17) |

## Getting started

```bash
pnpm install
pnpm build
```

Requires Node 20+, pnpm 9+. A running OpenSearch instance is needed for retrieval and reinforcement experiments — see `deploy/` for Docker Compose and Aiven configurations.

## Experiments

`packages/experiment-corpus` contains a numbered experiment series validating substrate behaviour end-to-end. Results are in `packages/experiment-corpus/results/`. The lab notebook is at `docs/experiments.md`.

```bash
OPENSEARCH_URL=http://localhost:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp17
```

## Implementation status

`docs/architecture/inventory.md` is the source of truth for what is built vs drafted.

## Documentation

Architecture specs, articles, research paper, and whitepaper: [SBPnet/cognitive-substrate-docs](https://github.com/SBPnet/cognitive-substrate-docs)

## License

PolyForm Noncommercial 1.0.0 — see `LICENSE`.
