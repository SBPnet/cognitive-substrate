# @cognitive-substrate/attention-engine

Routes attention candidates through a multi-lane salience budget, emitting interrupt, primary, background, and dropped classifications.

## What it does

Given a list of `AttentionCandidate` items and a policy snapshot, the engine scores each candidate and allocates it to one of four lanes:

| Lane | Trigger |
| ---- | ------- |
| `interrupt` | Salience above interrupt threshold |
| `primary` | Within the primary budget |
| `background` | Remaining budget after primary is full |
| `dropped` | Over total budget capacity |

### Salience formula

```text
salience = importance×0.29 + relevance×0.20 + urgency×0.18
         + novelty×(0.30 × explorationFactor) + risk×0.08
         + focusPersistenceBonus − ageDecay
```

`explorationFactor` comes from the active policy, allowing the system to shift between exploitation (low novelty weight) and exploration (high novelty weight) modes.

## API

```ts
import { AttentionEngine, AttentionAllocation, scoreSalience } from '@cognitive-substrate/attention-engine';

const engine = new AttentionEngine(policy);
const allocation: AttentionAllocation = engine.allocate(candidates);
// allocation.interrupt, .primary, .background, .dropped
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `AttentionEngine` | Main allocator; takes a `Policy` at construction |
| `AttentionAllocation` | Four-lane output |
| `scoreSalience(candidate, policy)` | Standalone scoring function |

## Dependencies

- `@cognitive-substrate/core-types` — `AttentionCandidate`, `Policy`
