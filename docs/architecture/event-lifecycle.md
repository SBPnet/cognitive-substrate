# Event / Experience Lifecycle

End-to-end flow of a telemetry event from ingestion through consolidation, reinforcement, and eventual decay/retirement.

```mermaid
flowchart TD
    A([Raw Telemetry Event\ne.g. page_view, article_complete]) --> B

    subgraph INGEST["Ingest Layer (ingest-worker)"]
        B[TelemetryEvent mapper\nimportance score, tags, summary] --> C[ExperienceWriter\nbatch: 50 events / 5s flush]
    end

    C --> D[(experience_events\nOpenSearch index\nauto-embedded by ML pipeline)]

    D --> E[Kafka: experience.raw topic]

    subgraph LOOP["CognitiveLoop (orchestrator)"]
        E --> F[MemoryRetriever\nHybrid BM25 + k-NN\noptional cross-encoder rerank]
        F --> G[AttentionEngine\nsalience scoring → lane assignment]
        G --> H{Lane}
        H -->|interrupt| I[Interrupt Processing]
        H -->|primary| J[Primary Context]
        H -->|background| K[Background Queue]
        H -->|dropped| L[/dropped/]
        I & J --> M[Agent Arbitration\nMultiAgentRuntime]
        M --> N[ReinforcementEngine\nscores signal → updates retrieval_priority]
        N --> O[PolicyEngine\nupdates ef / rt / policy vector]
        O --> P[AffectEngine\nnorepi / stress / arousal]
        P --> Q[IdentityEngine\ntrait delta accumulation]
    end

    N --> R[Kafka: consolidation.request]

    subgraph CONSOLIDATION["Consolidation (consolidation-worker)"]
        R --> S[Replay candidate window\nexperience_events]
        S --> T[Synthesize SemanticMemory\nimportance avg, severity propagation]
    end

    T --> U[(memory_semantic\nOpenSearch index\ndecay_factor=1.0)]

    U --> V[Kafka: retrieval.feedback]

    subgraph DECAY["Decay Cycle (scheduled)"]
        U --> W[DecayEngine\nage + retrieval_priority + contradiction_score]
        W --> X{Decision}
        X -->|RETAIN| U
        X -->|SUPPRESS| Y[lower retrieval_priority\nstay indexed]
        X -->|COMPRESS| Z[summarize → re-index\nimportance band ≤0.45]
        X -->|RETIRE| AA[mark retired\nremove from active retrieval]
        X -->|PRUNE| AB([deleted from index])
    end

    V --> N
    F -.->|cache miss| D
```

## Stage summary

| Stage | Trigger | Output |
|---|---|---|
| Ingest → `experience_events` | telemetry event arrives | embedded document |
| `experience_events` → CognitiveLoop | Kafka `experience.raw` | live context window |
| CognitiveLoop → `memory_semantic` | consolidation request | semantic summary |
| Reinforcement → policy | agent completes turn | updated `ef`/`rt` vector |
| Decay cycle | scheduled background job | RETAIN / SUPPRESS / COMPRESS / RETIRE / PRUNE |

## Key invariants

- Re-consolidation must run every ≤5 epochs to prevent catastrophic convergence (Exp 13/16).
- `retrieval_priority` is written only by `ReinforcementEngine` — never set manually.
- `memoryIndex` in experiment config must match `SOURCE_INDEX` used during seeding.
- Contradiction-heavy signals reduce `retrieval_priority` and can drive `decay_factor` toward RETIRE.
