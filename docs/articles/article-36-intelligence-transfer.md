# Stage 36: Intelligence Transfer

*This article accompanies Stage 36 of the cognitive-substrate project. It describes the mechanism by which operational knowledge learned in one infrastructure environment becomes usable in another through system mappings and primitive-level pattern representation.*

## Transfer as a representation problem

Operational knowledge usually fails to transfer because it is encoded at the wrong level. A dashboard panel, alert rule, or incident note refers to concrete metric names, cluster shapes, thresholds, and service conventions. Those details matter locally, but they obscure the behavioural structure that recurs across systems.

Stage 36 treats transfer as a representation problem. Knowledge transfers when it is expressed in operational primitives rather than vendor metrics. A pattern written in terms of `BACKPRESSURE_ACCUMULATION`, `QUEUE_GROWTH`, and `RETRY_AMPLIFICATION` can apply anywhere those dynamics appear.

## The mapping boundary

The `SystemMapping` interface is the boundary between local telemetry and general knowledge. It binds metric names or wildcard patterns to primitive identifiers. Built-in mappings exist for Aiven Kafka, OpenSearch, PostgreSQL, and ClickHouse. New systems can provide additional mappings without changing the pattern worker or reinforcement worker.

This creates a clean onboarding procedure:

- Identify the service type and metric vocabulary.
- Define a `SystemMapping` for its metric names.
- Configure the telemetry worker with the mapping.
- Observe primitive events and validate mapping coverage.
- Allow existing pattern documents to match the new primitive stream.

The only system-specific artifact is the mapping. The library of patterns remains system-agnostic.

## Zero-shot pattern application

Once a new system produces primitive events, the pattern worker can match existing patterns immediately. This is zero-shot application in an operational sense: the new system has not produced local outcome history yet, but existing cross-system patterns can still fire because their signatures are expressed at the primitive level.

This does not imply equal confidence across all environments. It means the detector has usable hypotheses from the first event. The reinforcement worker then calibrates those hypotheses through local outcomes.

## Local calibration after transfer

Transferred knowledge begins as inherited confidence. Local feedback adjusts that confidence. Patterns that generalize well become more trusted in the new environment. Patterns that match superficially but fail to produce useful interventions lose confidence.

This distinction is important. Transfer supplies prior knowledge, not final certainty. The confidence update loop turns the transferred prior into an environment-specific posterior over time.

## What cannot transfer

Raw thresholds do not transfer reliably. Topology assumptions do not transfer reliably. Product-specific remediation steps do not transfer unless the target system supports the same control surface.

The transferable unit is the behavioural pattern and its abstract intervention logic. Local runbooks may still adapt a recommendation into concrete action, such as changing a Kafka partition count, increasing database connection capacity, or throttling ingestion.

## Artifacts (Tier A)

**Stage covered:** 36, Intelligence Transfer.

**Packages shipped:** `packages/abstraction-engine/src/primitives/mapping-layer.ts` defines the mapping DSL and built-in mappings. `apps/workers/telemetry/` accepts additional mappings and emits primitive events for new systems.

**Operational contract:** Pattern documents in `operational_patterns` remain vendor-neutral. `SystemMapping` definitions carry all system-specific metric vocabulary.

**Tier B:** Transfer evidence requires onboarding a new system mapping and showing pattern matches before local retraining or local outcome accumulation.

**Quantitative claims:** Cross-system transfer effectiveness remains a design proposal pending comparative evaluation across environments.

*Source code: `packages/abstraction-engine/src/primitives/mapping-layer.ts`, `apps/workers/telemetry/`, `apps/workers/pattern/`, and `apps/workers/reinforcement/`. Architecture documentation: `docs/architecture/operational-primitives.md`. Companion paper chapter: `docs/paper/30-intelligence-transfer.md`.*
