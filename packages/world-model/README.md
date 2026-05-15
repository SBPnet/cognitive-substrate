# @cognitive-substrate/world-model

Outcome simulation and risk prediction. Runs a simulation model against a proposed action, materializes predictions, and records observed outcomes for accuracy tracking.

## What it does

Before the cognitive loop executes an action, the world model engine simulates likely outcomes and assesses risk. After execution, it back-fills the observed outcome against the prediction to track simulation accuracy over time.

The engine is built around a pluggable `OutcomeSimulationModel` interface:

- **Default** — `HeuristicOutcomeSimulationModel` uses policy parameters and historical memory scores to estimate probability and impact.
- **Custom** — inject any model that satisfies the interface for higher-fidelity simulation.

Predictions can optionally be persisted to OpenSearch and broadcast to Kafka for downstream consumers (e.g. metacog, reinforcement).

## API

```ts
import { WorldModelEngine, WorldModelPrediction } from '@cognitive-substrate/world-model';

const engine = new WorldModelEngine({ model, store, publisher });

// Before action:
const prediction: WorldModelPrediction = await engine.predict(context, proposedAction);
// prediction.expectedOutcome, prediction.riskScore, prediction.confidence

// After action:
await engine.recordOutcome(prediction.id, actualOutcome);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `WorldModelEngine` | Main engine; inject optional `store` and `publisher` |
| `WorldModelPrediction` | Expected outcome, risk score, confidence, and timestamp |
| `HeuristicOutcomeSimulationModel` | Default heuristic simulation model |

## Dependencies

- `@cognitive-substrate/core-types` — `AgentContext`, action and outcome types
- `@cognitive-substrate/kafka-bus` — broadcasts predictions and outcomes
- `@cognitive-substrate/memory-opensearch` — persists predictions for accuracy tracking
