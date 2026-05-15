# @cognitive-substrate/temporal-engine

Multi-timescale planning and subjective-time allocation. Ranks tasks by urgency, infers the active planning horizon, and sequences episodes within an inference budget.

## What it does

The temporal engine answers two questions before each cognitive loop cycle:

1. **What should be done now?** — ranks pending tasks by a composite urgency score and returns a `TemporalPlan` with the ordered sequence for this cycle.
2. **How much time to spend?** — `allocateSubjectiveTime()` converts the inference budget (tokens, latency headroom) into a subjective-time allocation per task, compressing time as workload density rises.

### Urgency formula

```text
urgency = importance×0.45 + deadlinePressure×0.40 + scaleWeight×0.15
```

`deadlinePressure` spikes non-linearly as the deadline approaches. `scaleWeight` gives a small boost to tasks that operate at the current dominant planning horizon (immediate / session / long-term).

## API

```ts
import { TemporalEngine, TemporalPlan, computeUrgency } from '@cognitive-substrate/temporal-engine';

const engine = new TemporalEngine();
const plan: TemporalPlan = engine.plan(tasks, budget);
// plan.ordered[] — tasks sorted by urgency
// plan.horizon — inferred planning horizon for this cycle
// plan.timeAllocation — subjective time per task
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `TemporalEngine` | Main planner; call `.plan(tasks, budget)` |
| `TemporalPlan` | Ordered tasks, horizon, and time allocation map |
| `computeUrgency(task)` | Standalone urgency scorer |
| `allocateSubjectiveTime(budget, tasks)` | Distributes inference budget across tasks |

## Dependencies

- `@cognitive-substrate/core-types` — `Goal`, `ReasoningBudget` types
