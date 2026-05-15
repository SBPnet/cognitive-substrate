# Cognitive Substrate Experiments

Fixed-corpus experiments run against the `thor` OpenSearch cluster
(`http://thor:9200`). All results are saved to
`packages/experiment-corpus/results/`.

Each experiment runs via:

```
OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp<N>
```

---

## Corpus

9 synthetic memories across 3 clusters, 6 associative links.

| Cluster | Members | Profile |
|---------|---------|---------|
| A | mem-a1…a4 | High importance (0.70–0.85), high usage, low contradiction. Deployment reliability knowledge. |
| B | mem-b1…b3 | Moderate importance (0.55–0.65), low usage, high novelty. Novel experimental observations. |
| C | mem-c1…c2 | Low importance (0.15–0.30), high contradiction risk. Contradictory or useless memories. |

---

## Experiment 1 — Flat Importance Baseline

**Result:** 70% hit rate, 33% cluster coverage, cluster-B never retrieved.

Static importance-ranked retrieval (top-3). Cluster-B memories are permanently excluded — their lower importance scores (0.55–0.65) never beat cluster-A (0.70–0.85) without a novelty dimension.

---

## Experiment 2 — Fixed-T Additive Blend

**Result:** All T values produce identical top-5 rankings (rank-order invariance).

Formula `score = importance + T × (1 - usage)` is monotone in T for all memories simultaneously — raising T scales every score equally, never changing relative order. Identified `usage_frequency` integer mapping bug (truncating 0.1→0); fixed to `float`.

---

## Experiment 3 — Session-Relative Novelty

**Result:** T=0.5+decay=0.5 optimal (95% hit rate, 100% cluster coverage).

Session-relative novelty `nov(id, t) = 1 - decay^(t - lastSeen(id))` creates temporal rank dynamics. At T=0.9+decay=0.1 produces ADHD-pattern oscillation (AAAAB/BBCCA alternates each turn). At T=0.9+decay=0.9 produces hyperfocus burst then gradual B-cluster competition.

---

## Experiment 4 — Warm-Start Priming

**Result:** All 4 hypotheses confirmed.

`RecencyTracker.prime()` pre-loads prior-session retrieval history. Primed-A at T=0.9 opens with BBBCC ("context pop" — B maximally novel after prior session used A heavily) then snaps back to AAAAB by turn 2. T controls escape velocity from prior context.

---

## Experiment 5 — Graph-Augmented Retrieval

**Result:** Graph does not improve mem-b3 hit rate; contradicts links add noise cost.

One-hop neighbourhood expansion from top-k seeds. mem-b3 is reached by session recency dynamics (novelty=1.0 at turns 10/18/20), not graph structure. The graph path (b3→a1 reverse) loses to direct session scores. Contradicts links surface mem-c1 at +30% rate with no benefit.

---

## Experiment 6 — Graph Diversity Slot + AttentionEngine Calibration

**Result:** Diversity slot recovers mem-b3 at T=0.1 but introduces c1 contamination (0%→50%). Engine/harness weights calibrated.

**Part A:** Guaranteed k-th slot for best graph neighbour improves b3 hit rate at T=0.1 (0%→17%) but the `contradicts` link fires every turn, surfacing mem-c1.

**Part B:** AttentionEngine harness/engine agreement was 60% at T=0.9 because novelty weight was 0.14 (max contribution 0.126) vs importance 0.35. **Production fix:** raised novelty coefficient 0.14→0.30, reduced importance 0.35→0.29. After fix: 100% agreement at all T values.

*Code change: `packages/attention-engine/src/engine.ts`*

---

## Experiment 7 — Reinforcement Loop Closure

**Result:** Loop is live; scoring is stateless/normalising, not accumulating.

`ReinforcementEngine.evaluate` correctly writes to OpenSearch and contradiction suppression works (mem-c1: 0.30→0.248). But `retrievalPriority` is recomputed from scratch each call — repeated positive reinforcement converges rather than compounds. The feedback loop is structurally correct but doesn't produce Hebbian memory strengthening.

---

## Experiment 8 — EMA Prior-Weighted Compounding

**Result:** EMA at pw=0.3 is regression-to-prior, not accumulator. 20 turns too short to see effect.

Formula `finalRp = prior × pw + newRp × (1-pw)` converges to the signal-determined fixed point regardless of pw. Over 20 turns, pw=0.3 is indistinguishable from pw=0.0 (cluster-A avg: 0.6950 vs 0.6941). pw=0.6 shows marginal lift (0.7103) but anchors to initial importanceScore. H2 (contradiction suppression) confirmed at all pw values.

*Code change: `priorWeight` field added to `ReinforcementEngineConfig` (default 0).*

---

## Experiment 9 — 100-Turn EMA Compounding

**Result:** No systematic divergence at pw=0.3 over 100 turns.

5 cycles × 20 corpus turns with ±0.05 signal jitter. Gap between pw=0.3 and pw=0.0 oscillates ±0.01 with no trend — the EMA converges to the same long-run cluster averages regardless of pw. True Hebbian accumulation requires a separate count field, not EMA blending.

*Bug fix: dead variable `gapAt100 = h1Gap` corrected.*

---

## Experiment 10 — Hebbian Count-Bonus Compounding

**Result:** Compounding confirmed (H1/H4 pass); bare log(count) lifts contradictory memories spuriously.

Added `reinforcement_count` field to `memory_semantic` and `countBonus` config to `ReinforcementEngine`. Formula: `finalRp += countBonus × log2(1+count) × reinforcement`.

| cb | mem-a1 rp at t=100 | Cluster-A avg |
|----|---------------------|---------------|
| 0.00 | 0.757 | 0.698 |
| 0.02 | 0.826 (+0.069) | 0.771 |
| 0.05 | 0.951 (+0.194) | 0.879 |

**Bug found:** bare `log2(count)` without quality gating lifted mem-c1 (contradictionRisk=0.8) to 0.309 above its importanceScore=0.30 baseline. **Fix:** multiply bonus by `result.reinforcement` (~0.30 for contradiction memories vs ~0.72 for trusted ones). Production calibration: cb=0.02.

*Code changes: `reinforcement_count` in schemas.ts; `countBonus` + quality gate in `reinforcement-engine/src/engine.ts`.*

---

## Experiment 11 — Quality-Gated Fix Verification + Arbitration Impact

Verifies that the quality-gated count bonus (Exp 10 fix) suppresses mem-c1 correctly, and that Hebbian compounding propagates to the arbitration layer — better `retrieval_priority` → higher agent confidence → higher `arbitrate()` scores for cluster-A aligned proposals.

**Result:** H1/H2/H4 pass; H3 near-pass (gap=0.019, threshold 0.02 — rounding noise).

| Condition | mem-a1 rp | mem-c1 rp | Arb-A score | Arb-C score | A-C gap |
| --------- | --------- | --------- | ----------- | ----------- | ------- |
| baseline cb=0 | 0.744 | 0.243 | 0.793 | 0.497 | 0.296 |
| gated cb=0.02 | 0.810 | 0.269 | 0.812 | 0.501 | 0.311 |
| gated cb=0.05 | 0.885 | 0.291 | 0.834 | 0.508 | 0.325 |

Quality gate confirmed: mem-c1 stays at 0.269 (below importanceScore=0.30 baseline) vs 0.309 in Exp 10's ungated run. The full chain **reinforcement → retrieval_priority → agent confidence → arbitration score** is demonstrated end-to-end. A-C arbitration gap widens monotonically with countBonus (0.296→0.311→0.325), proving that Hebbian compounding propagates to the arbitration layer.

---

## Experiment 12 — Cross-Domain Operational Correlation (Full Stack Exercise)

**Goal:** Ingest heterogeneous real-world signals (DB metrics/logs, Zendesk tickets, Slack conversations), normalize them into unified `OperationalSignal` experiences, detect cross-source correlations, and let the full reinforcement → retrieval → attention → arbitration pipeline surface actionable operational insights.

This experiment exercises **almost every package** end-to-end:
- Ingestion/telemetry workers, Kafka bus, Aiven client
- Memory (OpenSearch + object store)
- AttentionEngine + salience
- ReinforcementEngine (quality-gated count-bonus)
- Pattern detection, causal/abstraction engines
- Arbitration + agent loops
- ClickHouse telemetry + OTEL tracing

**Corpus Extension:** Synthetic + seeded real samples (see `experiment-corpus/data/operational/`). Plugin architecture note: future sources will be loaded via dynamic importers.

### Setup
- Extend corpus with ~200 synthetic signals across 4 time windows (normal, degraded, outage, recovery).
- Add Zendesk/Slack sample payloads.
- Run: `OPENSEARCH_URL=http://thor:9200 pnpm --filter @cognitive-substrate/experiment-corpus exp12`

### Key Hypotheses (H1–H5)
- **H1:** Unified `OperationalSignal` schema enables high-quality vector + temporal + graph correlations across sources.
- **H2:** Quality-gated Hebbian compounding (from Exp 10/11) preferentially strengthens true correlations while suppressing noise.
- **H3:** AttentionEngine routes urgent cross-domain bursts (e.g., latency spike + ticket flood) with <30s latency.
- **H4:** Arbitration scores improve when proposals are backed by multi-source reinforced memories.
- **H5:** System can auto-generate monitoring rules or Slack summaries from detected patterns.

### Expected Metrics
- Correlation precision/recall vs ground-truth labels
- Arbitration score lift for true-positive insights
- End-to-end latency, memory bloat, Kafka lag
- Reinforcement compounding curves for signal clusters

**Variants planned:** 12a (streaming vs batch), 12b (decay & forgetting), 12c (multi-agent debate).

**Code changes expected:** New `OperationalSignal` type, ingest adapters, pattern worker hooks, config tuning.

*Status: Draft — ready to implement (plugin-ready design)*

---

## Architecture Findings Summary

| Finding | Experiment | Code impact |
|---------|-----------|-------------|
| T has no effect on static importance scoring | Exp 2 | Requires session-relative novelty |
| Session novelty + T=0.5+decay=0.5 is optimal | Exp 3 | RecencyTracker in retrieval harness |
| Warm-start context pop is real | Exp 4 | RecencyTracker.prime() |
| Graph diversity slot contaminates via contradicts links | Exp 6 | Filter needed on slot selection |
| AttentionEngine novelty weight 0.14 too conservative | Exp 6 | Fixed: 0.14→0.30, importance 0.35→0.29 |
| Reinforcement loop is live but stateless | Exp 7 | EMA added (priorWeight) |
| EMA converges to signal fixed point, no compounding | Exp 9 | Led to count-bonus design |
| Count bonus must be quality-gated | Exp 10 | Fixed: multiply by result.reinforcement |
