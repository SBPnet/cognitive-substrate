# @cognitive-substrate/consolidation-engine

Orchestrates sleep-cycle memory consolidation: selects replay candidates, synthesizes semantic memories, and marks source events as consolidated.

## What it does

Consolidation runs offline (outside the hot cognitive loop) and performs three steps:

1. **Candidate selection** — queries OpenSearch for recent experience events using a decay-aware filter, prioritising high-importance unconsolidated events.
2. **Synthesis** — passes candidates through a `ConsolidationModel` (default: extractive) to produce `SemanticMemory` records with stability and contradiction scores.
3. **Write-back** — persists new memories to OpenSearch and marks source events as `consolidated: true` to prevent double-processing.

## API

```ts
import { ConsolidationEngine, ExtractiveConsolidationModel } from '@cognitive-substrate/consolidation-engine';

const engine = new ConsolidationEngine({ store, model: new ExtractiveConsolidationModel() });
const result: ConsolidationResult = await engine.run(sessionId);
// result.consolidated = number of events processed
// result.memoriesCreated = new SemanticMemory records written
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ConsolidationEngine` | Main runner; inject a `store` and optional `model` |
| `ConsolidationResult` | Summary counts + any errors |
| `ExtractiveConsolidationModel` | Default model; extracts content directly from source events |

## Dependencies

- `@cognitive-substrate/core-types` — `Experience`, `Memory` types
- `@cognitive-substrate/memory-opensearch` — candidate query and memory write-back
