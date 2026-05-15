# @cognitive-substrate/policy-engine

Closed-loop policy update coordinator. Reads the current policy snapshot, computes a bounded delta from reinforcement evaluation, advances the version, and persists state.

## What it does

The policy engine is the write path for all policy mutations. It wraps a pluggable `PolicyStore` and enforces that every update:

1. Loads the current policy from the store.
2. Computes the proposed delta via `computePolicyDelta()` using the incoming reinforcement signal.
3. Returns the delta to the caller for constitutional approval (see `constitution-engine`) before committing.
4. On approval, writes the new policy version and emits a `PolicyAuditEvent` for traceability.

It is intentionally stateless between calls — all state lives in the store.

## API

```ts
import { PolicyEngine, PolicyUpdateResult } from '@cognitive-substrate/policy-engine';

const engine = new PolicyEngine({ store, telemetry });
const result: PolicyUpdateResult = await engine.update(reinforcementSignal);
// result.previous — policy before update
// result.next — proposed new policy
// result.auditEvent — structured audit record
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `PolicyEngine` | Main updater; inject `store` and optional `telemetry` |
| `PolicyUpdateResult` | Previous policy, proposed next policy, audit event |
| `computePolicyDelta(policy, signal)` | Standalone delta computation (used by constitution engine) |

## Dependencies

- `@cognitive-substrate/core-types` — `Policy`, `ReinforcementSignal`
- `@cognitive-substrate/memory-opensearch` — default `PolicyStore` implementation
- `@cognitive-substrate/telemetry-otel` — emits policy update spans
