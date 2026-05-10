# Stage 33: Pattern Detection Worker

*This article accompanies Stage 33 of the cognitive-substrate project. It describes the worker that detects operational failure patterns from streams of operational primitive events and emits recommendations for incident response.*

## Pattern detection after abstraction

The pattern worker never reads vendor metric names. It consumes `cognition.primitives`, maintains a sliding window of recent primitive events, and compares the active primitive set against an operational pattern library.

This is the point where the Stage 30 vocabulary becomes operationally useful. A pattern can describe a cascading backpressure loop as a conjunction of `BACKPRESSURE_ACCUMULATION`, `QUEUE_GROWTH`, and `RETRY_AMPLIFICATION`. The same pattern can match Kafka lag, search queue rejection, database waits, or analytics ingestion pressure if each system mapping produces the same primitive signature.

## Sliding-window matching

The detector implementation in `apps/workers/pattern/src/detector.ts` keeps a five-minute `PrimitiveWindow`. Each new primitive event is pushed into the window, and events older than the detection horizon are evicted.

For each loaded pattern, the detector checks two conditions. A full signature match occurs when every primitive in `pattern.signature` is active in the window. A precursor match occurs when every primitive in `pattern.precursors` is active, but the full signature has not yet appeared.

Full matches use the pattern's confidence as the match score. Precursor matches use a reduced score. Candidate matches below the confidence threshold are suppressed, and the remaining candidates are sorted by score and capped before publication.

## Pattern library loading

Patterns are loaded from the `operational_patterns` OpenSearch index. This makes the library mutable without redeploying the worker. Confidence updates from the reinforcement worker can change match priority as evidence accumulates.

The worker falls back to `SEED_PATTERNS` when the index is empty or unavailable. This fallback ensures that a fresh deployment can detect a small set of common distributed-system failure modes before any learned patterns have accumulated.

## Recommendation events

When a pattern matches, the worker emits a `cognition.recommendations` event. The recommendation includes the pattern identifier, match score, outcome description, and ordered interventions from the pattern document.

The event is diagnostic rather than autonomous. It gives incident response systems a ranked interpretation of current telemetry. Remediation remains outside this stage, because automated action requires additional policy controls, approval gates, and rollback logic.

## Why pattern documents are system-agnostic

The invariant established in Stage 30 applies here directly: pattern documents cannot depend on vendor names, metric names, cluster identifiers, or topology-specific labels. The detector is therefore small because the complexity of system adaptation has been isolated in mappings.

This division of labour protects transfer. A detector that reads raw metrics would learn surface names. A detector that reads primitives learns behavioural signatures.

## Artifacts (Tier A)

**Stage covered:** 33, Pattern Detection Worker.

**Packages shipped:** `apps/workers/pattern/` implements the worker, sliding-window detector, OpenSearch pattern loading, and recommendation emission.

**Storage and topics:** The worker reads `cognition.primitives`, loads patterns from `operational_patterns`, and emits `cognition.recommendations`.

**Tier B:** Runtime evidence requires primitive events from the telemetry worker and a reachable OpenSearch cluster. Seed pattern behaviour is defined in `packages/abstraction-engine/src/primitives/pattern-library.ts`.

**Quantitative claims:** Pattern detection accuracy and early-warning value remain empirical questions pending replay and incident outcome analysis.

*Source code: `apps/workers/pattern/` and `packages/abstraction-engine/src/primitives/pattern-library.ts`. Architecture documentation: `docs/architecture/operational-primitives.md`. Companion paper chapter: `docs/paper/27-pattern-detection.md`.*
