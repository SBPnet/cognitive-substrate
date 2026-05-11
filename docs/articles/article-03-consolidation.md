# Stage 3: Consolidation Worker

## Claim

Consolidation gives memory an offline replay path. The implemented worker and engine can select replay candidates, build semantic memory drafts, write consolidated memory, and emit semantic update events. This supports a sleep-cycle-like architecture without claiming human-like consolidation.

## Runtime Surface

The worker lives in `apps/workers/consolidation/`. The reusable engine lives in `packages/consolidation-engine/`. It reads replay candidates from OpenSearch, uses an extractive consolidation model, writes semantic records, and emits `memory.semantic.updated` using the topic registry in `packages/kafka-bus/src/topics.ts`.

`docs/architecture/consolidation-worker.md` records the architecture boundary, and `packages/memory-opensearch/src/schemas.ts` defines the relevant memory indexes.

## Evidence

The inventory marks Stage 3 as implemented with behavioral evidence. Source coverage includes `apps/workers/consolidation/src/worker.ts`, `packages/consolidation-engine/src/engine.ts`, and `packages/consolidation-engine/src/model.ts`.

## Limitations

The default model is extractive. Claims about abstraction quality, contradiction resolution, or improved future retrieval require evaluation over real memory corpora and repeated consolidation runs.
