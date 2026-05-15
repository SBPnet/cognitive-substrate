# @cognitive-substrate/metacog-engine

Metacognition orchestrator. Reflects on prior cognitive loop iterations, calibrates confidence, attributes failures, and proposes self-modification when error exceeds threshold.

## What it does

After each cognitive loop cycle (or periodically), the metacog engine inspects the loop's output history and asks: "How well is the system reasoning?" It performs three steps:

1. **Calibration** — compares predicted confidences to actual outcomes and computes a calibration error score.
2. **Failure attribution** — when outcomes are poor, attributes root cause to one of: risk miscalculation, memory retrieval miss, or execution error.
3. **Self-modification proposals** — if calibration error exceeds 0.35, or if risk consistently exceeds budget, it emits `PolicyMutationProposal` objects for the constitution and policy engines to evaluate.

## API

```ts
import { ReflectionEngine, ReflectionResult } from '@cognitive-substrate/metacog-engine';

const engine = new ReflectionEngine();
const result: ReflectionResult = engine.reflect(loopHistory);
// result.calibrationError — scalar; >0.35 triggers mutation proposal
// result.attributions[] — per-failure root cause labels
// result.proposals[] — PolicyMutationProposal objects
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ReflectionEngine` | Main reflector; call `.reflect(history)` |
| `ReflectionResult` | Calibration error, attributions, mutation proposals |

## Dependencies

- `@cognitive-substrate/agents` — `CognitiveLoopResult` history type
- `@cognitive-substrate/core-types` — `Policy`, `PolicyMutationProposal`
