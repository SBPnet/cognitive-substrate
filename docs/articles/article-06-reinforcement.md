# Stage 9: Reinforcement Scoring Engine

## Claim

The reinforcement layer turns outcome evidence into structured scoring signals for memory priority, policy evaluation, and identity-impact records. It preserves the distinction between scoring an outcome and mutating policy state.

## Runtime Surface

The scoring package is `packages/reinforcement-engine/`, especially `packages/reinforcement-engine/src/scoring.ts` and `packages/reinforcement-engine/src/engine.ts`. Operational feedback handling is implemented in `apps/workers/reinforcement/`, including `apps/workers/reinforcement/src/outcome-tracker.ts`.

Runtime topics must be checked against `packages/kafka-bus/src/topics.ts`. The current architecture status is documented in `docs/architecture/reinforcement-engine.md`.

## Evidence

The repository contains the scoring package, worker source, and package entrypoints. `docs/architecture/inventory.md` currently describes the stage conservatively because package scoring and all worker paths are not equivalent proof of a fully closed learning loop.

## Limitations

The implementation does not yet prove that reinforcement improves retrieval, policy adaptation, or operational recommendations. Those claims require controlled evaluations with before-and-after outcome data.
