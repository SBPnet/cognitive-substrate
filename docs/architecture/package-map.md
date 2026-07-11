# Package Map

Quick-reference table for every package and app in the monorepo. For implementation status (built vs. drafted vs. entrypoint-only) see [`inventory.md`](inventory.md); for the cognitive-loop turn flow see `docs/architecture/cognitive-loop.md`.

## Core infrastructure

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/core-types` | -- | Shared types: `ExperienceEvent`, `MemoryRecord`, `PolicyState`, `AgentContext`, `Goal`, all index identifiers | `packages/core-types/src/index.ts` |
| `@cognitive-substrate/memory-opensearch` | -- | OpenSearch client, all index schemas, `buildHybridQuery`, `search`, `indexDocument`, `updateDocument` | `packages/memory-opensearch/src/index.ts` |
| `@cognitive-substrate/memory-objectstore` | -- | S3-compatible archive for raw `ExperienceEvent` payloads (truth layer) | `packages/memory-objectstore/src/index.ts` |
| `@cognitive-substrate/kafka-bus` | -- | Typed producers/consumers, topic registry, W3C trace propagation | `packages/kafka-bus/src/index.ts` |
| `@cognitive-substrate/telemetry-otel` | -- | OpenTelemetry bootstrap and `cog.*` semantic conventions | `packages/telemetry-otel/src/index.ts` |
| `@cognitive-substrate/clickhouse-telemetry` | -- | ClickHouse batch inserters and table schemas for operational metrics | `packages/clickhouse-telemetry/src/index.ts` |
| `@cognitive-substrate/aiven-client` | -- | Aiven platform client utilities (Kafka/OpenSearch managed service config) | `packages/aiven-client/src/index.ts` |

## Cognitive loop (Stage 2 -- 5)

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/retrieval-engine` | 2 | Hybrid BM25 + k-NN recall, optional cross-encoder reranking, `RetrievalFeedbackWriter` | `packages/retrieval-engine/src/retriever.ts` |
| `@cognitive-substrate/attention-engine` | 14 | Salience scoring blending importance, novelty, and recency; coupleAttention boost under stress | `packages/attention-engine/src/engine.ts` |
| `@cognitive-substrate/policy-engine` | 4 | Stateful `PolicyState` vector with clamped EMA updates; `InMemoryPolicyStore` | `packages/policy-engine/src/index.ts` |
| `@cognitive-substrate/agents` | 5 | `CognitiveLoop`, `MultiAgentRuntime`, `arbitrate()`, `SessionManager`, `ReasoningModel` interface | `packages/agents/src/loop.ts` |

## Reinforcement and memory dynamics

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/reinforcement-engine` | 9 | Hebbian compounding: EMA + `countBonus * log2(count)` writes `retrieval_priority` | `packages/reinforcement-engine/src/engine.ts` |
| `@cognitive-substrate/consolidation-engine` | 3 | Background replay: selects `experience_events` candidates, writes `memory_semantic` | `packages/consolidation-engine/src/engine.ts` |
| `@cognitive-substrate/decay-engine` | 17 | Forgetting plan: RETAIN / SUPPRESS / COMPRESS / RETIRE / PRUNE cascade over retention score | `packages/decay-engine/src/engine.ts` |

## Cognitive engines (Series II)

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/metacog-engine` | 8 | `ReflectionEngine` + `CalibrationMonitor`: detects overconfidence and emits self-modification proposals | `packages/metacog-engine/src/index.ts` |
| `@cognitive-substrate/narrative-engine` | 10 | Identity accumulation: aggregates `IdentityImpactSignal` into a drifting `IdentityState` | `packages/narrative-engine/src/index.ts` |
| `@cognitive-substrate/world-model` | 11 | Outcome simulation: predicts action risk from vocabulary + memory/goal context | `packages/world-model/src/index.ts` |
| `@cognitive-substrate/temporal-engine` | 15 | Multi-timescale planner: micro/mid/long scale selection, density-driven inference budget | `packages/temporal-engine/src/index.ts` |
| `@cognitive-substrate/budget-engine` | 16 | Cognitive economics: approves slow/fast reasoning mode based on utility, cost, exhaustion | `packages/budget-engine/src/index.ts` |
| `@cognitive-substrate/affect-engine` | 18 | 5-dimensional affect vector (dopamine, norepinephrine, serotonin, curiosity, contradictionStress) | `packages/affect-engine/src/index.ts` |
| `@cognitive-substrate/social-engine` | 21 | User-model inference: trust score, cooperation signal, deception risk via EMA smoothing | `packages/social-engine/src/index.ts` |
| `@cognitive-substrate/grounding-engine` | 22 | Perceptual grounding: sensor readings to `ExperienceEvent` importance; active-inference probes | `packages/grounding-engine/src/index.ts` |
| `@cognitive-substrate/constitution-engine` | 23 | Constraint evaluation: identity stability, reward-corruption detection, policy-alignment gates | `packages/constitution-engine/src/index.ts` |
| `@cognitive-substrate/causal-engine` | 24 | Structural causal model: co-occurrence inference, counterfactual `do(x)` queries | `packages/causal-engine/src/index.ts` |
| `@cognitive-substrate/curiosity-engine` | 25 | Novelty-driven exploration: infoGain + novelty + uncertainty scoring; experiment plan proposals | `packages/curiosity-engine/src/index.ts` |
| `@cognitive-substrate/dream-engine` | 26 | Offline replay: synthetic scenario generation from memory pairs; stress-failure detection | `packages/dream-engine/src/index.ts` |
| `@cognitive-substrate/abstraction-engine` | 27 | Compression ladder: 5-level `experience -> pattern -> concept -> principle -> worldview` hierarchy | `packages/abstraction-engine/src/index.ts` |
| `@cognitive-substrate/development-engine` | 28 | Developmental stages: seed/novice/apprentice/integrative/open_ended; capability unlock cascade | `packages/development-engine/src/index.ts` |

## Introspection and self-modification

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/introspection-engine` | -- | Coverage gap detection, typed proposal schema, `IntrospectionEngine.assess()` | `packages/introspection-engine/src/index.ts` |

## Extensibility

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/plugin-loader` | -- | Runtime loading of `IngestMapperPlugin`, `EnginePlugin`, `ToolExecutorPlugin` via `CS_PLUGINS` env var | `packages/plugin-loader/src/loader.ts` |
| `@cognitive-substrate/tool-executor` | -- | Built-in tools (WebFetch, MemorySearch, WriteExperience) + MCP bridge; `CompositeToolExecutor` | `packages/tool-executor/src/index.ts` |
| `@cognitive-substrate/create-plugin` | -- | Scaffold new plugin packages: `pnpm --filter @cognitive-substrate/create-plugin scaffold` | `packages/create-plugin/src/index.ts` |

## Ingestion

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/ingest-worker` | -- | Kafka consumer: maps `TelemetryEvent` to `ExperienceEvent`, indexes into OpenSearch | `packages/ingest-worker/src/index.ts` |

## Evaluation

| Package | Stage | One-line purpose | Key entry point |
|---------|-------|-----------------|-----------------|
| `@cognitive-substrate/experiment-corpus` | -- | Fixed 9-memory corpus, numbered experiment harness (Exp 1 -- 50+) | `packages/experiment-corpus/src/` |

## Apps

| App | One-line purpose |
|-----|-----------------|
| `apps/orchestrator` | Production cognitive-loop worker: Kafka consumer driving `CognitiveLoop` per `user_input` event |
| `apps/api` | REST/BFF gateway: session control, memory search, webhook ingestion endpoints |
| `apps/workers` | Background workers: policy evaluation consumer, consolidation scheduler |
| `apps/web` | Cognitive workbench UI |

## Index name reference

All OpenSearch index names are defined as the `MemoryIndex` union in `packages/core-types/src/memory.ts`:

| Index | Contents |
|-------|----------|
| `experience_events` | Raw episodic events (all `ExperienceEvent` writes) |
| `memory_semantic` | Consolidated semantic memories produced by `ConsolidationEngine` |
| `policy_state` | `PolicyState` snapshots |
| `agent_activity` | `AgentActivityTrace` records from `MultiAgentRuntime` |
| `world_model_predictions` | WorldModelEngine outcome predictions |
| `goal_system` | `Goal` records managed by `GoalSystem` |
| `identity_state` | `IdentityState` snapshots from `NarrativeEngine` |
| `self_modifications` | Self-modification proposals from `IntrospectionEngine` |
| `memory_links` | Directed `MemoryLink` edges in the association graph |
| `retrieval_feedback` | `RetrievalFeedback` records written by `RetrievalFeedbackWriter` |
