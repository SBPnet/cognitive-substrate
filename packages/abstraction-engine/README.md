# @cognitive-substrate/abstraction-engine

Builds compression ladders from raw experience events and semantic memories, progressively abstracting concrete experiences into higher-order representations.

## What it does

The abstraction engine operates a five-level compression ladder:

```text
experience → pattern → concept → principle → worldview
```

At each level it groups related nodes, computes a symbolic label from token frequency across the group's content, and emits an `AbstractionNode`. The resulting `CompressionLadder` gives the rest of the system a coarse-grained view of accumulated knowledge that is cheaper to reason over than raw events.

## API

```ts
import { AbstractionEngine, CompressionLadder, symbolicLabel } from '@cognitive-substrate/abstraction-engine';

const engine = new AbstractionEngine();
const ladder: CompressionLadder = engine.build(experiences, memories);
// ladder.levels[0] = experience nodes, ladder.levels[4] = worldview nodes
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `AbstractionEngine` | Main class; call `.build(experiences, memories)` |
| `AbstractionNode` | A single node at any level of the ladder |
| `CompressionLadder` | Full five-level output structure |
| `symbolicLabel(tokens)` | Picks the most-frequent token as a label |

## Dependencies

- `@cognitive-substrate/core-types` — `Experience`, `Memory` input types

## Notes

Label generation is currently heuristic (token frequency). Embedding-based summarization is the intended upgrade path.
