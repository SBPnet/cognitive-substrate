# Experiment 59 — Paired Falsification: Persistent vs Reset Arms

**Run mode:** live
**Indexes:** `exp59_incident_events`, `exp59_incident_semantic`, `exp59_critique_events`, `exp59_critique_semantic` (never `memory_semantic`)
**Production defaults held:** countBonus=0.02, noveltyWeight=0.3, re-consolidation every 5 epochs

## Hypothesis table

| ID | Hypothesis | Result | Detail |
| -- | ---------- | ------ | ------ |
| H1 | Persistent A retrieves consolidated pattern in top-5; reset A does not | **PASS** | persistent=true reset=false |
| H2 | Persistent A: stale runbook absent from ordinary top-5; get-by-id succeeds | **PASS** | staleInTop5=false fetchable=true |
| H3 | Pattern confidence moves with outcome on persistent arm only | **PASS** | before=0.65625 after=0.7345867141604971 |
| H4 | Persistent B top-1=mem-cap-new; reset B top-1=mem-cap-old | **PASS** | persistent=mem-cap-new reset=mem-cap-old |
| H5 | mem-cap-old remains fetchable by id after suppression | **PASS** | fetchable=true |
| H6 | Gap (persistent hit − reset hit) reported even if zero | **PASS** | gapA=1 gapB=0 |

**Score:** 6/6 evaluated hypotheses PASS.

## Key findings

- **Scenario A gap** (persistent hit − reset hit) = **1** (persistent patternInTop5=true, reset=false).
- A persistent top-5: `mem-incident-pattern`; stale in top-5=false; stale get-by-id=true.
- Pattern confidence before/after outcome: 0.65625 → 0.7345867141604971.
- **Scenario B gap** (persistent hit − reset hit) = **0** (persistent top-1=`mem-cap-new`, reset top-1=`mem-cap-old`).
- Trust on mem-cap-old before/after critique: 0.7 → 0.44999999999999996; get-by-id after suppress=true.

## Gaps / engine notes

- `MemoryCritiqueEvent` and DecayEngine `suppress` exist. There is no first-class OpenSearch applier for forgetting plans; this experiment applies `suppressed:true` + lowered `retrieval_priority` after `DecayEngine.decide`, matching the forgetting article (suppress keeps the doc fetchable by id).
- `ConsolidationEngine` hardcodes `experience_events` / `memory_semantic`; experiment redirects via `searchClient` / `indexMemory` hooks so dedicated `exp59_*` indexes are used (no parallel memory stack).
- ReinforcementEngine `memoryIndex` typing is cast to the experiment index at the call site (same pattern as Exp 58).

## Production implications

1. **Apprenticeship requires persistence.** If consolidation + reinforcement + suppress are real, a new-session probe on a different service should still retrieve the pattern; an empty reset store should not. A null gap means the durable path is not yet carrying signal — do not mask that by tuning countBonus / noveltyWeight / re-consolidation interval.
2. **Suppress ≠ prune.** Contradicted runbooks and capacity claims should leave ordinary retrieval while remaining get-by-id addressable for audit.
3. **Critique → trust → replace.** High-confidence contradiction critiques should demote the old memory and allow a consolidated replacement to win top-1 without deleting history.
