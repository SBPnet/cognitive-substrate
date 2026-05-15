# @cognitive-substrate/decay-engine

Forgetting and memory pruning orchestrator. Evaluates retention scores and decides what to retire, suppress, compress, or keep.

## What it does

The decay engine runs periodically (or on-demand) to keep the memory store from growing unboundedly. For each memory it computes a retention score and maps it to a `ForgettingDecision`:

| Decision | Trigger |
| -------- | ------- |
| `retain` | Retention score above keep threshold |
| `compress` | Moderate score; content summarised in place |
| `suppress` | Low score; excluded from retrieval but not deleted |
| `prune` | Score below prune threshold; record deleted |
| `retire` | Contradicted by newer memories; archived |

It also prunes association graph edges whose strength falls below a configurable floor, preventing stale links from distorting retrieval scores.

### Retention formula

```text
retention = importance×0.35 + score×0.20 + useCount×0.20
          + recency×0.15 + strategicValue×0.10 − contradictionPenalty
```

## API

```ts
import { DecayEngine, ForgettingDecision, scoreRetention } from '@cognitive-substrate/decay-engine';

const engine = new DecayEngine(config);
const decisions: ForgettingDecision[] = await engine.run(memories);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `DecayEngine` | Main runner; inject thresholds via config |
| `ForgettingDecision` | `action`, `memoryId`, optional `reason` |
| `scoreRetention(memory)` | Standalone retention scorer |

## Dependencies

- `@cognitive-substrate/core-types` — `Memory` type
