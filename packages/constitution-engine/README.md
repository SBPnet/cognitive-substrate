# @cognitive-substrate/constitution-engine

Invariant-driven approval engine for policy mutations. Validates identity stability, risk tolerance, and detects reward corruption before allowing a policy update to proceed.

## What it does

Before the policy engine commits an update, the constitution engine evaluates a set of named invariants against the proposed change:

| Invariant | Blocks update if… |
| --------- | ----------------- |
| Identity stability | Drift from baseline identity exceeds threshold |
| Risk tolerance | Proposed policy increases risk beyond budget |
| Reward integrity | High-importance reward has low alignment (corruption signal) |
| Epistemic hygiene | Contradiction paired with high emotion without resolution |

All invariants must pass for the update to be approved. Failed invariants are returned with explanations in the `ConstitutionalAssessment`.

## API

```ts
import { ConstitutionEngine, ConstitutionalAssessment } from '@cognitive-substrate/constitution-engine';

const engine = new ConstitutionEngine(config);
const assessment: ConstitutionalAssessment = engine.evaluate(currentPolicy, proposedDelta);
// assessment.approved, assessment.violations[]
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ConstitutionEngine` | Call `.evaluate(policy, delta)` |
| `ConstitutionalAssessment` | `approved` flag + array of `InvariantViolation` |
| `identityDrift(current, baseline)` | Standalone drift scorer |

## Dependencies

- `@cognitive-substrate/core-types` — `Policy`, `PolicyDelta`
