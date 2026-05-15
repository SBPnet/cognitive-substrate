# @cognitive-substrate/reinforcement-engine

Reinforcement scoring and memory priority updates. Scores memories against incoming signals and optionally strengthens them via Hebbian log-count compounding.

## What it does

After each cognitive loop cycle, the reinforcement engine receives a `ReinforcementSignal` and applies it to the memories that were active during that cycle:

1. **Scoring** — `scoreReinforcement()` blends the signal's reward, alignment, and recency into a scalar update.
2. **EMA prior weighting** — the new score is merged with the memory's historical score via an exponential moving average (`priorWeight` default: 0.3).
3. **Hebbian compounding** — if `enableCountBonus` is set, memories that are reinforced repeatedly accumulate a `log(reinforcementCount)` bonus gated on signal quality, preventing low-signal memories from being spuriously lifted.
4. **Write-back** — updated `retrievalPriority` and `decayFactor` are persisted to OpenSearch.

## API

```ts
import { ReinforcementEngine, ReinforcementUpdate, scoreReinforcement } from '@cognitive-substrate/reinforcement-engine';

const engine = new ReinforcementEngine({ store, policy, enableCountBonus: true });
const updates: ReinforcementUpdate[] = await engine.apply(signal, activeMemories);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ReinforcementEngine` | Main applier; inject `store` and `policy` |
| `ReinforcementUpdate` | Per-memory score delta, new priority, new decay factor |
| `scoreReinforcement(memory, signal, policy)` | Standalone scorer |

## Dependencies

- `@cognitive-substrate/core-types` — `Memory`, `ReinforcementSignal`, `Policy`
- `@cognitive-substrate/memory-opensearch` — write-back store
- `@cognitive-substrate/policy-engine` — reads current policy for scoring weights

## Tuning notes

- `priorWeight=0.3` is the validated production default (see Experiment 8 results).
- `countBonus=0.02` is the validated production default (see Experiment 10 results).
- Setting `enableCountBonus: false` disables compounding and reverts to pure EMA.
