# @cognitive-substrate/causal-engine

Infers structural causal models from event co-occurrence and simulates counterfactual interventions.

## What it does

The causal engine builds a `StructuralCausalModel` — a directed graph of cause-effect relationships — by aggregating edges extracted from event text. Once a model exists, `simulateCounterfactual()` applies an intervention (forcing a variable to a value) and propagates the effect through the graph to produce a `CounterfactualResult`.

This gives the cognitive loop the ability to ask "what would have happened if X had been different?" without requiring a full re-run of the experience sequence.

## API

```ts
import { CausalEngine, StructuralCausalModel } from '@cognitive-substrate/causal-engine';

const engine = new CausalEngine();
const model: StructuralCausalModel = engine.infer(events);

const result = engine.simulateCounterfactual(model, { variable: 'load', value: 0 });
// result.predictedOutcome, result.affectedVariables
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `CausalEngine` | `.infer(events)` builds the model; `.simulateCounterfactual()` runs interventions |
| `StructuralCausalModel` | Directed graph of causal edges with strengths |
| `CounterfactualResult` | Predicted outcome and list of downstream affected variables |

## Dependencies

- `@cognitive-substrate/core-types` — `Experience` event type

## Notes

Edge inference is currently text co-occurrence based. A causal discovery algorithm (e.g. PC or FCI) is the intended upgrade path.
