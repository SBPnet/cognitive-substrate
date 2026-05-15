# @cognitive-substrate/development-engine

Developmental capability tracking and curriculum selection. Infers the agent's current learning phase and unlocks subsystems progressively.

## What it does

The development engine models the agent's growth through five phases:

| Phase | Unlocked subsystems |
| ----- | ------------------- |
| `seed` | Perception, basic memory |
| `novice` | Attention, affect |
| `apprentice` | Policy, reinforcement |
| `integrative` | Causal, narrative, metacog |
| `open_ended` | All subsystems + curiosity-driven exploration |

Phase transitions are triggered by accumulated capability evidence. Once in a phase, `selectCurriculum()` picks the next learning items by balancing difficulty (slight stretch over current level) against expected gain, penalising both under-stretch and over-reach.

## API

```ts
import { DevelopmentEngine, inferPhase, selectCurriculum } from '@cognitive-substrate/development-engine';

const engine = new DevelopmentEngine();
const phase = inferPhase(capabilityRecord);
const curriculum = selectCurriculum(phase, candidateItems);
// curriculum[] — ordered list of next items to attempt
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `DevelopmentEngine` | Stateful tracker; wraps `inferPhase` and `selectCurriculum` |
| `inferPhase(record)` | Maps capability evidence to a phase enum |
| `selectCurriculum(phase, items)` | Returns stretch-optimised item ordering |

## Dependencies

None.
