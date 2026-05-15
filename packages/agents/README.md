# @cognitive-substrate/agents

Runtime orchestration for the multi-agent cognitive loop. Wires together perception, retrieval, reasoning, action, and evaluation into a single runnable cycle.

## What it does

The `CognitiveLoop` owns the canonical perceive → retrieve → reason → act → evaluate pipeline. Each stage is backed by a pluggable port so individual engines can be swapped without changing the loop topology. The package also manages:

- **Sessions** — per-agent conversation state and activity stores
- **Goal system** — tracks active goals and feeds them into context assembly
- **Arbitration** — when multiple agents compete on the same input, arbitration selects the winner by policy

## API

```ts
import { CognitiveLoop, AgentContext } from '@cognitive-substrate/agents';

const loop = new CognitiveLoop({ policy, retriever, reasoner, executor, evaluator });
const result: CognitiveLoopResult = await loop.run(context);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `CognitiveLoop` | Main orchestrator; call `.run(context)` |
| `AgentContext` | Input bundle: session, goals, active memories, affect state |
| `CognitiveLoopResult` | Output: action taken, evaluation score, updated context |

## Dependencies

- `@cognitive-substrate/core-types`
- `@cognitive-substrate/kafka-bus` — publishes loop telemetry
- `@cognitive-substrate/memory-opensearch` — retrieves semantic memories
- `@cognitive-substrate/policy-engine` — reads and updates policy state

## Runtime wiring

Topic claims: see [`kafka-bus/src/topics.ts`](../kafka-bus/src/topics.ts).
Index claims: see [`memory-opensearch/src/schemas.ts`](../memory-opensearch/src/schemas.ts).
