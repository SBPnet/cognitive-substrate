# @cognitive-substrate/core-types

Shared TypeScript type definitions for the entire cognitive architecture. Every other package in the monorepo depends on this one.

## What it does

Defines the canonical data shapes for all cross-cutting concerns. No implementation code lives here — only types, interfaces, and enums. Keeping these in one place prevents type drift between packages and makes the data model readable in isolation.

### Type modules

| Module | Contents |
| ------ | -------- |
| `experience` | `Experience`, `ExperienceEvent`, sensor reading shapes |
| `memory` | `Memory`, `SemanticMemory`, retention metadata |
| `policy` | `Policy`, `PolicyDelta`, exploration/exploitation parameters |
| `goal` | `Goal`, `GoalStatus`, priority and deadline fields |
| `agent` | `Agent`, `AgentContext`, session state |
| `reinforcement` | `ReinforcementSignal`, `ReinforcementUpdate` |
| `world-model` | `WorldModelPrediction`, simulation output types |
| `interaction` | `Interaction`, `UserModel`, trust/intent fields |

## Usage

```ts
import type { Memory, Policy, Goal } from '@cognitive-substrate/core-types';
```

## Dependencies

None — this package is the base of the dependency graph.
