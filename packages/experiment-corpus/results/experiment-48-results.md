# Experiment 48 — IntrospectionEngine Pipeline

**Date**: 2026-05 (documented from run; results markdown backfilled 2026-07-10)
**Status**: ALL PASS

## Goal

Validate gap detection → typed proposal → ConstitutionEngine gate →
`substrate_proposals` round-trip → SchemaEvolutionApplier write of
`schema_evolution` events.

## Hypotheses

| ID | Hypothesis | Result |
|----|-----------|--------|
| H1 | IntrospectionEngine emits proposal with expectedGain ≥ 0.6 | **PASS** |
| H2 | ConstitutionEngine approves when stabilityRisk < 0.7 | **PASS** |
| H3 | ProposalStore save/listPending/getByMutationId round-trip | **PASS** |
| H4 | SchemaEvolutionApplier writes schema_evolution to experience_events | **PASS** |

## Key findings

1. Proposals are human-reviewable in `substrate_proposals` before apply.
2. Constitution gate blocks high stabilityRisk mutations.
3. Applied evolutions are auditable as `schema_evolution` experience events.

## Production implications

Keep apply path gated; do not auto-apply proposals without review in production.
