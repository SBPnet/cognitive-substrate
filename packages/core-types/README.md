# @cognitive-substrate/core-types

Shared TypeScript type definitions for the entire cognitive architecture. Every other package in the monorepo depends on this one.

## What it does

Defines the canonical data shapes for all cross-cutting concerns. No implementation code lives here — only types, interfaces, and enums. Keeping these in one place prevents type drift between packages and makes the data model readable in isolation.

### Type modules

| Module | Contents |
| ------ | -------- |
| `experience` | `ExperienceEvent`, `EventContext`, `EventSource`, `SystemSessionId`, sensor reading shapes |
| `memory` | `Memory`, `SemanticMemory`, retention metadata |
| `policy` | `Policy`, `PolicyDelta`, exploration/exploitation parameters |
| `goal` | `Goal`, `GoalStatus`, priority and deadline fields |
| `agent` | `Agent`, `AgentContext`, session state |
| `reinforcement` | `ReinforcementSignal`, `ReinforcementUpdate` |
| `world-model` | `WorldModelPrediction`, simulation output types |
| `interaction` | `Interaction`, `UserModel`, trust/intent fields |

### Event source scoping

`EventContext.source` discriminates the origin scope of every `ExperienceEvent`:

| Value | Meaning |
| --- | --- |
| `"session"` (default) | Produced within a live conversation or agent loop. Grouped into session windows by consolidation. |
| `"ambient"` | Background signal with no associated conversation: blog telemetry, reader engagement, infrastructure summaries. Becomes a freestanding memory any future session can recall. |
| `"system"` | Internal substrate bookkeeping: dream cycles, consolidation outputs, policy snapshots. No user identity implied. |

When absent, downstream code treats the event as `"session"` so all existing session-path code is unaffected.

Use `SystemSessionId` constants for the `sessionId` field on ambient and system events:

```ts
import { SystemSessionId } from "@cognitive-substrate/core-types";

// SystemSessionId.AMBIENT_TELEMETRY  -- infrastructure/telemetry summary workers
// SystemSessionId.DREAM_CYCLE        -- dream engine synthetic replay
// SystemSessionId.CONSOLIDATION      -- consolidation pass outputs
```

## Usage

```ts
import type { Memory, Policy, Goal } from '@cognitive-substrate/core-types';
```

## Dependencies

None — this package is the base of the dependency graph.
