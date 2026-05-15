# @cognitive-substrate/social-engine

Lightweight social cognition and user-model inference. Tracks per-user intent, trust, and deception risk across interactions.

## What it does

The social engine maintains a `UserModel` for each user the agent interacts with. On each interaction it:

1. **Infers intent** — classifies the interaction as `explanation`, `implementation`, or `general` using keyword-based heuristics.
2. **Updates trust** — applies exponential smoothing to a trust score based on interaction outcome and alignment signals.
3. **Tracks deception risk** — monitors for signals (inconsistency, manipulation markers) and smooths a deception risk score.
4. **Manages belief buffer** — retains the 20 most recent beliefs per user to inform future intent classification.

## API

```ts
import { SocialEngine, UserModel, inferIntent } from '@cognitive-substrate/social-engine';

const engine = new SocialEngine();
const model: UserModel = engine.update(userId, interaction, outcome);
// model.intent — 'explanation' | 'implementation' | 'general'
// model.trust — 0–1 smoothed trust score
// model.deceptionRisk — 0–1 smoothed risk score
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `SocialEngine` | Stateful per-user model tracker |
| `UserModel` | Intent, trust, deception risk, and recent beliefs |
| `inferIntent(interaction)` | Standalone keyword-based intent classifier |

## Dependencies

- `@cognitive-substrate/core-types` — `Interaction`, `UserModel` types
