# @cognitive-substrate/narrative-engine

Identity formation and narrative self-model synthesis. Accumulates evidence, stabilises drift, and publishes coherent identity updates to the cognitive bus.

## What it does

The narrative engine maintains a `NarrativeSelfModel` — a structured representation of the agent's beliefs about itself: its values, capabilities, characteristic behaviours, and long-term goals. It runs a three-stage pipeline:

1. **Accumulation** — ingests new evidence (observations, reinforcement signals, evaluations) and adds them to a rolling belief buffer (capped at 20 recent items).
2. **Stabilisation** — applies a drift-damping step to prevent rapid identity swings from single high-salience events.
3. **Synthesis** — generates a coherent narrative summary from the stabilised belief set and publishes an `IdentityUpdate` event to Kafka.

## API

```ts
import { NarrativeEngine, NarrativeSelfModel, IdentityFormationResult } from '@cognitive-substrate/narrative-engine';

const engine = new NarrativeEngine({ publisher });
const result: IdentityFormationResult = await engine.update(evidence);
// result.model — updated NarrativeSelfModel
// result.driftMagnitude — how much identity shifted this cycle
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `NarrativeEngine` | Main updater; inject an optional Kafka `publisher` |
| `NarrativeSelfModel` | Structured self-model: values, capabilities, goals, beliefs |
| `IdentityFormationResult` | Updated model + drift magnitude |

## Dependencies

- `@cognitive-substrate/core-types` — evidence and identity types
- `@cognitive-substrate/kafka-bus` — publishes identity updates
