# Experiment 45 — Paired Falsification: Persistent vs Reset Arms

**Run mode:** dry
**Indexes:** `exp45_incident_events`, `exp45_incident_semantic`, `exp45_critique_events`, `exp45_critique_semantic` (never `memory_semantic`)
**Production defaults held:** countBonus=0.02, noveltyWeight=0.3, re-consolidation every 5 epochs

## Hypothesis table

| ID | Hypothesis | Result | Detail |
| -- | ---------- | ------ | ------ |
| H1 | Persistent A retrieves consolidated pattern in top-5; reset A does not | DRY / UNEVALUATED | patternInTop5(persistent)=true ∧ patternInTop5(reset)=false |
| H2 | Persistent A: stale runbook absent from ordinary top-5; get-by-id succeeds | DRY / UNEVALUATED | staleInTop5=false ∧ staleFetchableById=true |
| H3 | Pattern confidence moves with outcome on persistent arm only | DRY / UNEVALUATED | patternConfidenceAfter > patternConfidenceBefore on persistent; reset has nulls |
| H4 | Persistent B top-1=mem-cap-new; reset B top-1=mem-cap-old | DRY / UNEVALUATED | top1(persistent)=mem-cap-new ∧ top1(reset)=mem-cap-old |
| H5 | mem-cap-old remains fetchable by id after suppression | DRY / UNEVALUATED | get(CRITIQUE_SEMANTIC, mem-cap-old) succeeds on persistent arm |
| H6 | Gap (persistent hit − reset hit) reported even if zero | DRY / UNEVALUATED | gapA and gapB always written; defaults countBonus=0.02 noveltyWeight=0.30 recon=5 held |

**Score:** dry run — no OpenSearch cluster; assertions described only.

## Key findings

- **Scenario A (dry):** Persistent arm would consolidate two incident episodes, reinforce the pattern with countBonus=0.02, suppress the stale runbook via DecayEngine, then probe with a new sessionId on another service. Reset arm drops indexes and probes an empty store. Gap = 1_persistent − 0_reset when H1 holds.
- **Scenario B (dry):** Persistent arm emits MemoryCritiqueEvent (contradiction, confidence 0.9), applies trust delta −0.25, indexes mem-cap-new from telemetry, suppresses mem-cap-old. Reset arm reseeds only mem-cap-old. Gap reported even if zero (H6).

## Gaps / engine notes

- `MemoryCritiqueEvent` and DecayEngine `suppress` exist. There is no first-class OpenSearch applier for forgetting plans; this experiment applies `suppressed:true` + lowered `retrieval_priority` after `DecayEngine.decide`, matching the forgetting article (suppress keeps the doc fetchable by id).
- `ConsolidationEngine` hardcodes `experience_events` / `memory_semantic`; experiment redirects via `searchClient` / `indexMemory` hooks so dedicated `exp45_*` indexes are used (no parallel memory stack).
- ReinforcementEngine `memoryIndex` typing is cast to the experiment index at the call site (same pattern as Exp 58).
- Cluster unreachable or OPENSEARCH_URL unset; live PASS/FAIL not evaluated.
- Prior blog-telemetry Exp 45 JSON archives under results/ remain historical; this script entrypoint is the paired falsification protocol.

## Production implications

1. **Apprenticeship requires persistence.** If consolidation + reinforcement + suppress are real, a new-session probe on a different service should still retrieve the pattern; an empty reset store should not. A null gap means the durable path is not yet carrying signal — do not mask that by tuning countBonus / noveltyWeight / re-consolidation interval.
2. **Suppress ≠ prune.** Contradicted runbooks and capacity claims should leave ordinary retrieval while remaining get-by-id addressable for audit.
3. **Critique → trust → replace.** High-confidence contradiction critiques should demote the old memory and allow a consolidated replacement to win top-1 without deleting history.
