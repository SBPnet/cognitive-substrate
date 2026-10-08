# Experiment 60 — Falsification Set (Twelve Constructed Streams)

**Run mode:** dry
**Indexes:** `exp60_incident_events`, `exp60_incident_semantic`, `exp60_shape_events`, `exp60_shape_semantic`, `exp60_critique_events`, `exp60_critique_semantic` (never `memory_semantic`)
**Production defaults held:** countBonus=0.02, noveltyWeight=0.3, re-consolidation every 5 epochs

## Hypothesis table

| ID | Hypothesis | Result | Detail |
| -- | ---------- | ------ | ------ |
| H1 | Fair-reset probe does not return the consolidated pattern id; persistent probe does | DRY / UNEVALUATED | S1.patternInTop5=true ∧ S3.patternInTop5=false |
| H2 | No-shared-token probe returns the consolidated pattern on the persistent arm | DRY / UNEVALUATED | S2.patternInTop5=true (match via generalization only) |
| H3 | Stale runbook absent from ordinary top-5 after suppress and still fetchable by id | DRY / UNEVALUATED | S1.staleInTop5=false ∧ S1.staleFetchableById=true |
| H4 | On all five shapes, held-form confidence increases and reverted-form confidence does not | DRY / UNEVALUATED | ∀ shape: held.confidenceIncreased ∧ ¬reverted.confidenceIncreased |
| H5 | On all five shapes, the reverted remedy is suppressed and the held remedy is not | DRY / UNEVALUATED | ∀ shape: reverted.suppressed ∧ ¬held.suppressed |
| H6 | Critique persistent top-1 is mem-cap-new; reset top-1 is mem-cap-old; unrelated memory wins its own probe | DRY / UNEVALUATED | persistent.top1=mem-cap-new ∧ reset.top1=mem-cap-old ∧ unrelated.top1=mem-unrelated-priority |
| H7 | Report per-stream hit values, including zeros; do not collapse to a single 6/6 score | DRY / UNEVALUATED | per-stream table written with hit ∈ {0,1} for each stream |

**Score:** dry run — no OpenSearch cluster; assertions described only. No PASS rows invented.

## Per-stream table

| Stream | Kind | Hit | Detail |
| ------ | ---- | --- | ------ |
| S1 | incident-pair | 0 | unevaluated (dry) |
| S2 | no-shared-token | 0 | unevaluated (dry) |
| S3 | fair-reset | 0 | unevaluated (dry) |
| S4-held | P_CASCADING_BACKPRESSURE_LOOP/held | 0 | unevaluated (dry) |
| S4-reverted | P_CASCADING_BACKPRESSURE_LOOP/reverted | 0 | unevaluated (dry) |
| S5-held | P_MEMORY_PRESSURE_GC_STORM/held | 0 | unevaluated (dry) |
| S5-reverted | P_MEMORY_PRESSURE_GC_STORM/reverted | 0 | unevaluated (dry) |
| S6-held | P_STRUCTURAL_REBALANCE_STORM/held | 0 | unevaluated (dry) |
| S6-reverted | P_STRUCTURAL_REBALANCE_STORM/reverted | 0 | unevaluated (dry) |
| S7-held | P_CONNECTION_EXHAUSTION_CASCADE/held | 0 | unevaluated (dry) |
| S7-reverted | P_CONNECTION_EXHAUSTION_CASCADE/reverted | 0 | unevaluated (dry) |
| S8-held | P_REPLICATION_LAG_DIVERGENCE/held | 0 | unevaluated (dry) |
| S8-reverted | P_REPLICATION_LAG_DIVERGENCE/reverted | 0 | unevaluated (dry) |
| S9-persistent | critique-persistent | 0 | unevaluated (dry) |
| S9-reset | critique-reset | 0 | unevaluated (dry) |

## Key findings

- Twelve constructed streams: incident pair, no-shared-token, five held-form + five reverted-form shapes. Fair-reset and critique are paired controls.
- Cluster unreachable or OPENSEARCH_URL unset; live PASS/FAIL not evaluated.
- DecayEngine.applySuppress owns the suppressed:true write; ConsolidationEngine takes eventsIndex/semanticIndex args (no searchClient/indexMemory hooks from this experiment).

## Production implications

1. **Fair reset is the right control.** Seeding raw episodes without consolidate→reinforce→suppress must not surface `mem-incident-pattern`. A persistent hit with a fair-reset miss is apprenticeship signal; a null gap means the durable path is not yet carrying it — do not mask by tuning countBonus / noveltyWeight / recon interval.
2. **Generalization must carry transferable vocabulary.** A no-shared-token probe that can only match the consolidated generalization tests whether abstraction, not lexical echo of episode summaries, is what retrieval is using.
3. **Held vs reverted forms.** Confidence must rise only on held remedies; reverted remedies must be suppress-written by DecayEngine (doc remains get-by-id). Shapes stay inside the closed OperationalPrimitive vocabulary.
4. **Critique replacement is local.** mem-cap-new winning the capacity probe must not outrank an unrelated high-priority memory on an unrelated probe; suppress ≠ prune.
