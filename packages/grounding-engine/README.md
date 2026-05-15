# @cognitive-substrate/grounding-engine

Converts raw sensor readings into experience events and proposes active-inference probes to reduce prediction error.

## What it does

The grounding engine sits at the boundary between the external world and the cognitive loop. It performs two roles:

1. **Perception** — maps structured sensor readings (metrics, observations, environment state) to `Experience` events using natural-language templates. Importance is proportional to reading magnitude.
2. **Active inference** — after each perception step, compares actual readings to prior predictions and computes a `predictionError` signal. For high-magnitude errors it proposes `ActiveInferenceProbe` actions — targeted queries or interventions to resolve the uncertainty.

## API

```ts
import { GroundingEngine, GroundingResult } from '@cognitive-substrate/grounding-engine';

const engine = new GroundingEngine();
const result: GroundingResult = engine.perceive(sensorReadings, priorPredictions);
// result.events[] — Experience events ready for the cognitive loop
// result.probes[] — proposed ActiveInferenceProbe actions
// result.predictionError — scalar error signal
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `GroundingEngine` | Main perceptor; call `.perceive(readings, predictions)` |
| `GroundingResult` | Events, probes, and prediction error |
| `toExperienceEvent(reading)` | Converts a single sensor reading to an `Experience` |
| `proposeActiveInferenceProbes(error)` | Generates probe actions for high-error readings |

## Dependencies

- `@cognitive-substrate/core-types` — `Experience`, sensor reading types
