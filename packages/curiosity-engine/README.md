# @cognitive-substrate/curiosity-engine

Ranks candidate states by information gain and exploration potential, then proposes concrete experiments for the cognitive loop to pursue.

## What it does

Given a set of candidate states (unexplored regions of the agent's knowledge space), the curiosity engine scores each one and returns a ranked `CuriosityAssessment`. From the top-ranked states it proposes up to five `ExperimentPlan` items describing what to try and what outcome to observe.

### Priority formula

```text
priority = informationGain×0.40 + novelty×0.25 + uncertainty×0.25 + unexploredBonus×0.10
```

States that have never been visited receive the unexplored bonus on top of their base score.

## API

```ts
import { CuriosityEngine, CuriosityAssessment, planExperiment } from '@cognitive-substrate/curiosity-engine';

const engine = new CuriosityEngine();
const assessment: CuriosityAssessment = engine.assess(candidateStates);
// assessment.ranked[] — sorted by priority descending
// assessment.experiments[] — up to 5 proposed ExperimentPlans
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `CuriosityEngine` | Main assessor; call `.assess(states)` |
| `CuriosityAssessment` | Ranked states + experiment proposals |
| `curiosityPriority(state)` | Standalone priority scorer |
| `planExperiment(state)` | Generates a single experiment plan from a state |

## Dependencies

None.
