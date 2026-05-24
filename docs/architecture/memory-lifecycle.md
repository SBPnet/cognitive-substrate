# Memory Lifecycle

A memory in this substrate begins as an `ExperienceEvent` and either competes for promotion to a semantic memory, accumulates retrieval-driven reinforcement, or decays into suppression and eventual pruning. This document traces each stage.

## Stage 1: ExperienceEvent write

Every cognitive turn, ambient telemetry event, or system bookkeeping output is captured as an `ExperienceEvent` (`packages/core-types/src/experience.ts`). The mandatory fields are:

```typescript
{
  eventId: string,          // UUID
  timestamp: string,        // ISO-8601
  type: EventType,          // "user_input" | "tool_result" | "agent_action" | ...
  context: {
    sessionId: string,      // real UUID for session events; SystemSessionId constant for ambient/system
    source?: "session" | "ambient" | "system"
  },
  input: { text: string, embedding: number[] },
  importanceScore: number,  // [0, 1] -- set by ingest mapper or caller
  tags: string[]
}
```

The `source` discriminator controls downstream routing:
- `"session"` (default): conversation-bound. Consolidation groups these by session window.
- `"ambient"`: background signal (blog telemetry, infra metrics). No session grouping; freestanding semantic memories.
- `"system"`: substrate bookkeeping (dream cycles, consolidation outputs, policy snapshots).

The event is written to two places: the `experience_events` OpenSearch index (for retrieval) and optionally to the S3-compatible object store via `memory-objectstore` (truth layer for the full payload including `structured` and `result` fields).

Embeddings are generated at index time via the OpenSearch ML ingest pipeline (field: `embedding_nomic` for `all-MiniLM-L6-v2` 384-dim, or `embedding_mpnet` for `all-mpnet-base-v2` 768-dim). Do not embed client-side unless testing.

## Stage 2: Retrieval and working memory

Each cognitive turn retrieves up to 8 memories from `experience_events` and `memory_semantic` via `MemoryRetriever.retrieve`. The retrieval score a memory receives in a given turn is its initial `importanceScore` modulated by the hybrid BM25 + k-NN query.

Retrieved memories are held in `CognitiveSession.workingMemory` as `MemoryReference` objects:

```typescript
{
  memoryId: string,
  index: MemoryIndex,
  score: number,          // query-time relevance score
  summary: string,
  importanceScore: number,
  lastRetrieved?: string
}
```

See `docs/architecture/retrieval-pipeline.md` for how the query is constructed.

## Stage 3: Reinforcement -- retrieval_priority accumulation

`ReinforcementEngine.evaluate` (`packages/reinforcement-engine/src/engine.ts`) is called after retrieval. It reads the current `retrieval_priority` and `reinforcement_count` on the memory document, computes a new retrieval priority via Hebbian compounding, and writes it back to OpenSearch:

```
EMA blend:    rp_new = prior_rp × priorWeight + scored_rp × (1 - priorWeight)
Count bonus:  rp_final += countBonus × log2(1 + count) × reinforcement
```

Production defaults (Exp 10/11): `priorWeight = 0`, `countBonus = 0.02`.

The quality gate is critical: the count bonus is multiplied by `reinforcement` (the signal quality, ~0.72 for trusted memories, ~0.30 for contradicted ones). Without this gate, low-signal memories accumulate count-bonus strength spuriously (Exp 10 bug).

`retrieval_priority` is the compound signal that the memory substrate uses for long-term ordering. It is distinct from `importanceScore` (set at write time, never updated by the engine) and from the query-time `score` (computed fresh each retrieval).

The engine also writes:
- `decay_factor`: scalar used by `DecayEngine` and `ConsolidationEngine` for replay selection
- `reinforcement_score`: the raw signal quality before EMA blending
- `reinforcement_count`: incremented each evaluation (used for the log bonus)

The engine does not own a Kafka producer. Callers decide whether the `policyVote` in the returned `ReinforcementUpdate` is published synchronously or batched.

## Stage 4: Consolidation -- experience_events to memory_semantic

`ConsolidationEngine.consolidate` (`packages/consolidation-engine/src/engine.ts`) runs as a background job. It:

1. Selects `experience_events` candidates ordered by `decay_factor` descending and `importance_score` descending, filtered by `minImportance` (default 0.1) and optionally by `requiredTags`.
2. Passes candidates to `ConsolidationModel.generate`, which produces a `summary`, `generalization`, and `embedding`.
3. Writes a new `SemanticMemory` to the `memory_semantic` index with `decay_factor: 1.0` and `usage_frequency: 0`.
4. Bumps `retrieval_count` on each source event to reduce future re-selection.

The default `ExtractiveConsolidationModel` concatenates high-importance summaries. It does not call an LLM; replace it with an LLM-backed model for production-quality consolidations.

`importanceScore` on the semantic memory is the average across source event importance scores. Severity ordering from operational signals propagates faithfully through this averaging (Exp 18, 30).

`stabilityScore` is a coarse proxy: average of (importanceScore + rewardScore) / 2 across candidates.

`contradictionScore` is a heuristic scan for negative-signal words (`contradict`, `conflict`, `failed`, `error`) in the source summaries.

**Index mismatch invariant**: The `memoryIndex` field in the loop config and the `SOURCE_INDEX` env var used during experiment seeding must point to the same index. A mismatch produces silent zero-result retrieval -- no error, just empty memories. This is the most common misconfiguration (Exp 28 note).

## Stage 5: Re-consolidation -- preventing catastrophic convergence

Without periodic re-retrieval, multiplicative decay erodes even strongly-reinforced memories until they fall below contradicted ones (Exp 13: cluster ordering inverts at epoch 100). Re-consolidation prevents this:

Every R epochs, memories with `retrieval_priority > RECON_THRESHOLD` receive a small positive boost (4% of `importanceScore`). Memories below the threshold don't qualify -- the mechanism is selective and O(trusted-memories), not O(all-memories).

**Production invariant (Exp 16)**: Re-consolidation must run every 5 epochs or fewer. Every 10 epochs reduces but does not prevent inversion. The exact epoch definition depends on how the decay job is scheduled.

## Stage 6: Decay -- forgetting plan

`DecayEngine.planForgetting` (`packages/decay-engine/src/engine.ts`) evaluates candidates via a cascading threshold check on a composite `retentionScore`:

```
retentionScore =
  importanceScore × 0.35
  + queryScore × 0.20
  + min(retrievalCount/20, 1) × 0.20
  + clamp(1 - ageDays/90) × 0.15
  + strategicValue × 0.10
  - contradictionScore × 0.35
```

The cascade (short-circuits at first match):

| Condition | Action | Reason |
|-----------|--------|--------|
| contradictionScore ≥ 0.8 AND retentionScore < 0.45 | `retire` | high_contradiction |
| retentionScore ≤ 0.22 | `prune` | low_retention |
| retentionScore ≤ 0.28 | `suppress` | retrieval_suppression |
| retentionScore ≤ 0.45 AND ageDays > 30 | `compress` | compression_candidate |
| otherwise | `retain` | retained |

Compress means: route to `ConsolidationEngine` for offline compression into a semantic memory. The `compress` branch requires `retention ≤ 0.45` (mid-band) _and_ age > 30 days. This deliberately excludes both fresh memories (regardless of importance) and already-worthless ones (which hit suppress/prune before reaching compress).

Typical per-severity behaviour at `ageDays=0`:
- Outage signals (importance 0.84 -- 0.96): retain 100%
- Degraded (0.68): retain 100%
- Recovery (0.26): suppress 70%, retain 30%
- Normal (0.14 -- 0.30): suppress 65%, retain 35%

At `ageDays=60`:
- Normal/recovery: all reach prune or suppress; no compress (retention too low to qualify)
- Degraded/outage: still mostly retain; compress eligible at ageDays ~45 -- 90

The engine also prunes the association graph (`memory_links` index): edges with `strength < pruneStrengthThreshold` (default 0.15) are dropped.

## Field summary

| Field | Set by | Updated by | Used by |
|-------|--------|------------|---------|
| `importanceScore` | ingest mapper / caller | never | DecayEngine (35% of retention), ConsolidationEngine (avg for semantic memory) |
| `retrieval_priority` | ReinforcementEngine | ReinforcementEngine (EMA + count bonus) | retrieval scoring, arbitration confidence, re-consolidation threshold |
| `decay_factor` | ConsolidationEngine (1.0 at write) | ReinforcementEngine | ConsolidationEngine replay selection (sort desc), DecayEngine projection |
| `reinforcement_count` | ReinforcementEngine | ReinforcementEngine (inc per eval) | log-bonus term in Hebbian compounding |
| `retrieval_count` | ConsolidationEngine (after consolidation) | inline | ConsolidationEngine replay de-prioritisation |
| `usage_frequency` | ConsolidationEngine (0 at write) | retrieval path | ConsolidationEngine replay ordering (sort asc) |
| `contradiction_score` | ConsolidationEngine | -- | DecayEngine cascade (retire gate), suppression weight |
| `stability_score` | ConsolidationEngine | -- | identity and policy signals |
