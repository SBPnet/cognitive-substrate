# @cognitive-substrate/budget-engine

Compute-budget gating for reasoning requests. Enforces utility, exhaustion, and quota constraints and selects between fast (heuristic) and slow (deliberative) cognition modes.

## What it does

Before the cognitive loop commits to a full reasoning cycle, the budget engine checks three independent constraints:

| Constraint | Rule |
| ---------- | ---- |
| Utility | Expected utility ≥ configured threshold |
| Exhaustion | Blended exhaustion score < 0.9 |
| Quota | Estimated token cost fits within remaining quota |

If all three pass, it returns a `BudgetDecision` recommending either `fast` or `slow` mode based on the exhaustion level. Any failed constraint returns `deny` with the blocking reason.

### Exhaustion formula

```text
exhaustion = tokenPressure×0.45 + toolPressure×0.35 + latencyPressure×0.20
```

## API

```ts
import { BudgetEngine, BudgetDecision, computeExhaustion } from '@cognitive-substrate/budget-engine';

const engine = new BudgetEngine(config);
const decision: BudgetDecision = engine.evaluate(request);
// decision.mode === 'fast' | 'slow' | 'deny'
// decision.reason explains any denial
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `BudgetEngine` | Main gate; call `.evaluate(request)` |
| `BudgetDecision` | `mode`, `reason`, `estimatedCost` |
| `computeExhaustion(metrics)` | Standalone exhaustion scorer |

## Dependencies

- `@cognitive-substrate/core-types` — `ReasoningRequest`, `BudgetConfig`
