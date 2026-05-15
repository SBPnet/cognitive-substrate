# @cognitive-substrate/affect-engine

Maintains a neurochemical affect vector and couples it to attention candidates to modulate salience across the cognitive loop.

## What it does

The affect engine tracks five dimensions of internal state:

| Dimension | Role |
| --------- | ---- |
| `dopamine` | Reward signal; drives exploitation |
| `norepinephrine` | Arousal; boosts urgency weighting |
| `serotonin` | Stability; dampens novelty-seeking |
| `curiosity` | Information-seeking drive |
| `contradictionStress` | Tension from unresolved inconsistencies |

Each dimension is updated by blending the incoming stimulus with the current state using exponential moving averages. The combined vector maps to a discrete `mood` label (stressed, cautious, curious, exploratory, settled) via `classifyMood()`.

## API

```ts
import { AffectEngine, AffectVector, classifyMood } from '@cognitive-substrate/affect-engine';

const engine = new AffectEngine();
const state = engine.update(stimulus);
// state.vector.curiosity, state.mood === 'exploratory', etc.

const candidates = engine.modulateCandidates(attentionCandidates, state);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `AffectEngine` | Call `.update(stimulus)` to advance state; `.modulateCandidates()` to reweight salience |
| `AffectVector` | Five-dimensional neurochemical state |
| `AffectState` | Vector + derived mood label |
| `classifyMood(vector)` | Maps a vector to a mood enum value |

## Dependencies

- `@cognitive-substrate/attention-engine` — `AttentionCandidate` type used for salience modulation
