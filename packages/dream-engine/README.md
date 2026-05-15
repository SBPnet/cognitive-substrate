# @cognitive-substrate/dream-engine

Offline synthetic replay engine. Pairs semantic memories, synthesizes adversarial scenarios, and generates dream-tagged experience events for stress-testing the cognitive loop.

## What it does

The dream engine runs during idle/sleep cycles to create synthetic training signal without requiring new real-world interactions. It:

1. **Pairs memories** — selects adjacent or thematically related `SemanticMemory` records as scenario seeds.
2. **Synthesizes scenarios** — generates adversarial `DreamScenario` objects by inverting or contrasting the paired memories, computing a stress score from contradiction density and stability.
3. **Emits events** — produces `Experience` events tagged `source: 'dream'` that feed back into the consolidation and reinforcement pipelines.

The curiosity engine is consulted during pairing to bias towards high-information-gain combinations.

## API

```ts
import { DreamEngine, DreamScenario, DreamCycleResult } from '@cognitive-substrate/dream-engine';

const engine = new DreamEngine({ curiosityEngine });
const result: DreamCycleResult = await engine.run(memories);
// result.scenarios[] — generated DreamScenario objects
// result.events[] — synthetic Experience events ready for ingestion
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `DreamEngine` | Main runner; optionally inject a `CuriosityEngine` for smarter pairing |
| `DreamScenario` | A paired memory scenario with stress and novelty scores |
| `DreamCycleResult` | Scenarios + synthetic events produced in one cycle |

## Dependencies

- `@cognitive-substrate/core-types` — `Memory`, `Experience` types
- `@cognitive-substrate/curiosity-engine` — guides memory pairing toward high-gain combinations
