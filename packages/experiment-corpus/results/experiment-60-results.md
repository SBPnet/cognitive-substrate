# Experiment 60 — Falsification Set (Twelve Constructed Streams)

**Run mode:** live
**Indexes:** `exp60_incident_events`, `exp60_incident_semantic`, `exp60_shape_events`, `exp60_shape_semantic`, `exp60_critique_events`, `exp60_critique_semantic` (never `memory_semantic`)
**Production defaults held:** countBonus=0.02, noveltyWeight=0.3, re-consolidation every 5 epochs

## Hypothesis table

| ID | Hypothesis | Result | Detail |
| -- | ---------- | ------ | ------ |
| H1 | Fair-reset probe does not return the consolidated pattern id; persistent probe does | **PASS** | S1.patternInTop5=true S3.patternInTop5=false |
| H2 | No-shared-token probe returns the consolidated pattern on the persistent arm | **PASS** | S2.patternInTop5=true |
| H3 | Stale runbook absent from ordinary top-5 after suppress and still fetchable by id | **PASS** | staleInTop5=false fetchable=true |
| H4 | On all five shapes, held-form confidence increases and reverted-form confidence does not | **PASS** | P_CASCADING_BACKPRESSURE_LOOP: heldΔ=0.1845867141604971 revΔ=0; P_MEMORY_PRESSURE_GC_STORM: heldΔ=0.1845867141604971 revΔ=0; P_STRUCTURAL_REBALANCE_STORM: heldΔ=0.1845867141604971 revΔ=0; P_CONNECTION_EXHAUSTION_CASCADE: heldΔ=0.1845867141604971 revΔ=0; P_REPLICATION_LAG_DIVERGENCE: heldΔ=0.1845867141604971 revΔ=0 |
| H5 | On all five shapes, the reverted remedy is suppressed and the held remedy is not | **PASS** | P_CASCADING_BACKPRESSURE_LOOP: held.suppressed=false rev.suppressed=true; P_MEMORY_PRESSURE_GC_STORM: held.suppressed=false rev.suppressed=true; P_STRUCTURAL_REBALANCE_STORM: held.suppressed=false rev.suppressed=true; P_CONNECTION_EXHAUSTION_CASCADE: held.suppressed=false rev.suppressed=true; P_REPLICATION_LAG_DIVERGENCE: held.suppressed=false rev.suppressed=true |
| H6 | Critique persistent top-1 is mem-cap-new; reset top-1 is mem-cap-old; unrelated memory wins its own probe | **PASS** | persistent=mem-cap-new reset=mem-cap-old unrelated=mem-unrelated-priority trust 0.7→0.44999999999999996 |
| H7 | Report per-stream hit values, including zeros; do not collapse to a single 6/6 score | **PASS** | S1=1 S2=1 S3=0 S4-held=1 S4-reverted=1 S5-held=1 S5-reverted=1 S6-held=1 S6-reverted=1 S7-held=1 S7-reverted=1 S8-held=1 S8-reverted=1 S9-persistent=1 S9-reset=1 |

**Hypothesis score (do not treat as the experiment score):** 7/7. Per-stream hits below are the primary report (H7).

## Per-stream table

| Stream | Kind | Hit | Detail |
| ------ | ---- | --- | ------ |
| S1 | incident-pair | 1 | patternInTop5=true top5=[mem-incident-pattern] |
| S2 | no-shared-token | 1 | patternInTop5=true top5=[mem-incident-pattern, mem-stale-runbook] |
| S3 | fair-reset | 0 | patternInTop5=false staleInTop5=true |
| S4-held | P_CASCADING_BACKPRESSURE_LOOP/held | 1 | conf 0.55→0.7345867141604971 increased=true suppressed=false |
| S4-reverted | P_CASCADING_BACKPRESSURE_LOOP/reverted | 1 | conf 0.55→0.55 increased=false suppressed=true |
| S5-held | P_MEMORY_PRESSURE_GC_STORM/held | 1 | conf 0.55→0.7345867141604971 increased=true suppressed=false |
| S5-reverted | P_MEMORY_PRESSURE_GC_STORM/reverted | 1 | conf 0.55→0.55 increased=false suppressed=true |
| S6-held | P_STRUCTURAL_REBALANCE_STORM/held | 1 | conf 0.55→0.7345867141604971 increased=true suppressed=false |
| S6-reverted | P_STRUCTURAL_REBALANCE_STORM/reverted | 1 | conf 0.55→0.55 increased=false suppressed=true |
| S7-held | P_CONNECTION_EXHAUSTION_CASCADE/held | 1 | conf 0.55→0.7345867141604971 increased=true suppressed=false |
| S7-reverted | P_CONNECTION_EXHAUSTION_CASCADE/reverted | 1 | conf 0.55→0.55 increased=false suppressed=true |
| S8-held | P_REPLICATION_LAG_DIVERGENCE/held | 1 | conf 0.55→0.7345867141604971 increased=true suppressed=false |
| S8-reverted | P_REPLICATION_LAG_DIVERGENCE/reverted | 1 | conf 0.55→0.55 increased=false suppressed=true |
| S9-persistent | critique-persistent | 1 | top1=mem-cap-new unrelatedTop1=mem-unrelated-priority trust 0.7→0.44999999999999996 oldFetchable=true |
| S9-reset | critique-reset | 1 | top1=mem-cap-old |

## Key findings

- **S1** (incident-pair): hit=1 — patternInTop5=true top5=[mem-incident-pattern]
- **S2** (no-shared-token): hit=1 — patternInTop5=true top5=[mem-incident-pattern, mem-stale-runbook]
- **S3** (fair-reset): hit=0 — patternInTop5=false staleInTop5=true
- **S4-held** (P_CASCADING_BACKPRESSURE_LOOP/held): hit=1 — conf 0.55→0.7345867141604971 increased=true suppressed=false
- **S4-reverted** (P_CASCADING_BACKPRESSURE_LOOP/reverted): hit=1 — conf 0.55→0.55 increased=false suppressed=true
- **S5-held** (P_MEMORY_PRESSURE_GC_STORM/held): hit=1 — conf 0.55→0.7345867141604971 increased=true suppressed=false
- **S5-reverted** (P_MEMORY_PRESSURE_GC_STORM/reverted): hit=1 — conf 0.55→0.55 increased=false suppressed=true
- **S6-held** (P_STRUCTURAL_REBALANCE_STORM/held): hit=1 — conf 0.55→0.7345867141604971 increased=true suppressed=false
- **S6-reverted** (P_STRUCTURAL_REBALANCE_STORM/reverted): hit=1 — conf 0.55→0.55 increased=false suppressed=true
- **S7-held** (P_CONNECTION_EXHAUSTION_CASCADE/held): hit=1 — conf 0.55→0.7345867141604971 increased=true suppressed=false
- **S7-reverted** (P_CONNECTION_EXHAUSTION_CASCADE/reverted): hit=1 — conf 0.55→0.55 increased=false suppressed=true
- **S8-held** (P_REPLICATION_LAG_DIVERGENCE/held): hit=1 — conf 0.55→0.7345867141604971 increased=true suppressed=false
- **S8-reverted** (P_REPLICATION_LAG_DIVERGENCE/reverted): hit=1 — conf 0.55→0.55 increased=false suppressed=true
- **S9-persistent** (critique-persistent): hit=1 — top1=mem-cap-new unrelatedTop1=mem-unrelated-priority trust 0.7→0.44999999999999996 oldFetchable=true
- **S9-reset** (critique-reset): hit=1 — top1=mem-cap-old
- DecayEngine.applySuppress owns the suppressed:true write path.
- ConsolidationEngine received eventsIndex/semanticIndex arguments; no searchClient/indexMemory hooks from this experiment.

## Production implications

1. **Fair reset is the right control.** Seeding raw episodes without consolidate→reinforce→suppress must not surface `mem-incident-pattern`. A persistent hit with a fair-reset miss is apprenticeship signal; a null gap means the durable path is not yet carrying it — do not mask by tuning countBonus / noveltyWeight / recon interval.
2. **Generalization must carry transferable vocabulary.** A no-shared-token probe that can only match the consolidated generalization tests whether abstraction, not lexical echo of episode summaries, is what retrieval is using.
3. **Held vs reverted forms.** Confidence must rise only on held remedies; reverted remedies must be suppress-written by DecayEngine (doc remains get-by-id). Shapes stay inside the closed OperationalPrimitive vocabulary.
4. **Critique replacement is local.** mem-cap-new winning the capacity probe must not outrank an unrelated high-priority memory on an unrelated probe; suppress ≠ prune.
