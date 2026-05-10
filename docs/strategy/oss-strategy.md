# Open Source Strategy

## Thesis

Cognitive Substrate should adopt an open-core infrastructure strategy. The core architecture, runtime packages, schemas, local deployment assets, and SDK surface should remain open to maximize adoption, citations, and ecosystem trust. Managed orchestration, enterprise governance, multi-tenant operations, and advanced cognition observability can become commercial surfaces.

## Open Components

- `@cognitive-substrate/*` core packages
- Local runtime and worker applications
- Kafka topic declarations
- OpenSearch index schemas
- OpenTelemetry semantic conventions
- Reference deployment manifests
- Whitepaper and academic paper
- Developer SDK and examples

## Commercial Components

- Managed cognitive clusters
- Multi-tenant memory isolation
- Enterprise memory governance
- Reinforcement analytics
- Branch and salience visualization dashboards
- Hosted replay and counterfactual debugging
- Enterprise policy and constitution management
- Managed marketplace templates

## License Position

The current license for the core runtime, SDK, and supporting packages is the PolyForm Noncommercial License 1.0.0. The restriction is deliberate during the research and pre-publication phase: it preserves the ability to evaluate commercial, dual-licensed, or open-core arrangements once the architecture stabilizes and the design produces results worth defending. Noncommercial research, study, teaching, hobby experimentation, and use by educational and public institutions are explicitly permitted by that license.

A future relicense to a more permissive arrangement remains an option once the substrate has reached a defensible release. Candidate end states include a dual-licensed model (a permissive license such as Apache 2.0 for the core, alongside a commercial license for hosted or enterprise components), a source-available license such as Business Source License with a delayed conversion to a permissive license, or AGPL for server-side components that would otherwise be trivial to rehost as a competing managed service. Any change should be documented as an explicit governance decision rather than an implicit drift.

## Governance

The project should add governance, security, contribution, and trademark files before broad public promotion. The GitHub remote and on-disk repository can be renamed to `cognitive-substrate` as a separate migration after the internal package and documentation rename lands.

## Release Ladder

### Research release

The first public milestone publishes the academic paper, whitepaper, architecture docs, diagrams, and local smoke instructions. Success criteria are editorial consistency, reproducible local startup, and verification gates for build, typecheck, test, and lint.

### Local runtime release

The second milestone packages the API, web app, orchestrator, and worker set as a local developer runtime. Success criteria are deterministic environment templates, seeded example data, one-command smoke tests, and documented failure recovery.

### Reference deployment release

The third milestone publishes deployment assets for Kafka, OpenSearch, ClickHouse, PostgreSQL, object storage, and OpenTelemetry collectors. Success criteria are topology diagrams, sizing assumptions, retention policies, schema migration instructions, and benchmark harnesses.

### Hosted alpha

The hosted alpha introduces managed orchestration, hosted telemetry dashboards, branch replay, salience inspection, and managed policy state. Success criteria are tenancy isolation, billing instrumentation, operational runbooks, and support boundaries.

### Enterprise governance alpha

The enterprise governance alpha adds policy approval workflows, audit exports, retention controls, compliance reporting, and private deployment guidance. Success criteria are explicit control ownership, architecture decision records, security review, and documented support levels.

## Package Boundary Policy

Core packages remain open when they define runtime behavior, public schemas, event contracts, SDK interfaces, local deployment, or reproducibility artifacts. Commercial packages may begin where the value depends on managed operations, multi-tenant control planes, hosted compliance, proprietary dashboards, or enterprise policy workflows.

## Decision Thresholds

Quantitative performance claims require reproducible benchmark data. Enterprise feature claims require at least one deployment scenario and an operational runbook. Hosted feature claims require isolation, observability, backup, and incident response definitions before public launch.
