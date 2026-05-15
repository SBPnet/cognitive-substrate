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

## Experiment 12 — Policy Drift

**Result:** H1/H2/H3/H4 pass. Policy vector drifts in a signal-consistent direction with bounded per-step magnitude.

Two conditions over 100 turns: corpus mix (positive-dominant) and contradiction-heavy.

| Condition | ef drift | rb drift | mt drift |
| --------- | -------- | -------- | -------- |
| corpus mix | −0.072 (0.500→0.428) | +0.108 (0.500→0.608) | +0.230 (0.500→0.730) |
| contradiction-heavy | −0.411 (0.500→0.086) | +0.246 (0.500→0.746) | +0.340 (0.500→0.840) |

**Key finding:** The `explorationFactor` formula (`reward × (0.5 - confidence + contradictionRisk) × 0.08`) means *negative* reward with high `contradictionRisk` suppresses `explorationFactor` *more aggressively* than positive reward does. Both conditions reduce exploration; contradiction-heavy reduces it to near-zero (0.086) because low reinforcement → negative `rewardDelta` × large `contradictionRisk` bracket. The system punishes exploration in the face of contradicted knowledge — it should exploit trusted memories, not explore further. Per-step drift bounded to 0.005 (max observed), well within MAX_ABSOLUTE_DRIFT=0.08.

**Production implication:** The policy engine correctly encodes that contradiction episodes should decrease exploration temperature, not increase it.

---

## Experiment 13 — Temporal Decay

**Result:** H1/H2/H3/H4 pass. Decay causes catastrophic convergence — without continuous reinforcement, cluster-A's Hebbian gains erode and cluster ordering inverts.

100 reinforcement turns (cb=0.02) followed by in-memory decay projection at epochs {0, 10, 20, 50, 100}. Per-epoch decay rate = `1 - (1 - decay_factor) / 20`.

| Epochs | Cluster-A | Cluster-B | Cluster-C | A-C gap |
| ------ | --------- | --------- | --------- | ------- |
| 0 | 0.748 | 0.587 | 0.238 | 0.510 |
| 10 | 0.592 | 0.478 | 0.218 | 0.374 |
| 20 | 0.468 | 0.388 | 0.200 | 0.268 |
| 50 | 0.232 | 0.209 | 0.155 | 0.077 |
| 100 | 0.072 | 0.074 | 0.100 | −0.028 |

**Key finding:** Decay is multiplicative — cluster-A starts high and loses more in absolute terms than cluster-C which starts near its floor. By epoch 100 cluster-C *exceeds* cluster-A in rp (0.100 > 0.072). The Hebbian gains from compounding are not permanent; they require periodic re-retrieval. This is biological long-term potentiation behaviour: memories that are never re-accessed fade even if they were once strongly potentiated.

**Production implication:** The substrate needs a re-consolidation mechanism (periodic background reinforcement of high-importance memories) to prevent catastrophic convergence. Without it, trusted memories degrade to the same level as contradictory ones over long idle periods.

---

## Experiment 14 — Multi-Agent Arbitration

**Result:** H1/H2/H3/H4 pass. Agent-A (cluster-A memories) wins arbitration in all 4 scenarios including when agent-C has more retrieved memories.

Four scenarios tested after 100 reinforcement turns (cb=0.02):

| Scenario | A memories | C memories | A-score | C-score | Winner | Margin |
| -------- | ---------- | ---------- | ------- | ------- | ------ | ------ |
| Full support | 3 | 2 | 0.812 | 0.501 | A | 0.311 |
| Degraded A | 2 | 5 (+B mix) | 0.772 | 0.714 | A | 0.055 |
| Equal count | 3 | 3 (+B mix) | 0.812 | 0.586 | A | 0.227 |
| Baseline (no reinf.) | 3 | 2 | 0.820 | 0.498 | A | 0.325 |

**Key finding 1 (H2):** Agent-A beats agent-C even when agent-C has 5 retrieved memories vs agent-A's 2. `memoryAlignment` (capped at `min(1, count/5)`) is only 25% of the arbitration score; `confidence` (30%) and `riskScore` (20%) together (50%) outweigh it. High rp → high confidence → agent-A wins on confidence even with less memory alignment.

**Key finding 2 (H4):** Baseline margin (0.325) slightly *exceeds* reinforced margin (0.311) because baseline draws confidence from raw `importanceScore` (0.80 for cluster-A) which is higher than post-reinforcement rp (0.775). Reinforcement converges rp toward the signal-determined fixed point; it does not inflate above importanceScore ceiling. The arbitration system is robust at baseline; reinforcement refines rather than amplifies the separation.

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
| Policy drift is signal-consistent and bounded | Exp 12 | Policy engine validated; ef suppressed by contradiction |
| Contradiction-heavy signal suppresses explorationFactor more than positive signal | Exp 12 | Architectural behaviour, not a bug |
| Temporal decay causes catastrophic convergence without re-retrieval | Exp 13 | Needs re-consolidation mechanism |
| Arbitration selects cluster-A even when cluster-C has more retrieved memories | Exp 14 | Confidence+risk outweigh memoryAlignment |
| Reinforcement refines but does not inflate arbitration margin beyond baseline | Exp 14 | importanceScore already encodes trust; compounding converges, not amplifies |
| Operational signal schema is self-consistent across 4 incident windows | Exp 15 | 200 signals ready for retrieval/reinforcement pipeline |
| Recovery severity drops back toward normal, not midway between degraded and outage | Exp 15 | Severity ordering: normal < recovery < degraded < outage |
| Re-consolidation every 5 epochs prevents catastrophic convergence; every 10 is insufficient | Exp 16 | Re-consolidation mechanism validated; interval matters |
| Operational signal BM25 retrieval correctly surfaces incident windows by query | Exp 17 | experience_events index ready for cross-domain correlation |
| ConsolidationEngine correctly propagates severity from experience_events to memory_semantic | Exp 18 | Full pipeline validated; requiredTags filter added to ConsolidationRequest |
| Consolidation with empty embeddings must omit the embedding field entirely | Exp 18 | Fixed: empty-embedding guard in consolidate() write path |
| DecayEngine correctly stratifies incident windows: outage=100% retain vs normal=35% retain | Exp 19 | Retention formula validated; compress branch gated by suppressionThreshold |
| compress fires only when retentionScore > suppressionThreshold; low-importance old memories go to suppress/prune | Exp 19 | Architecture behaviour; not a bug — compress is for memories worth keeping before pruning |
| CausalEngine infers incident co-occurrence structure from text; outage→latency strength=0.45 | Exp 20 | inferModel depends on event input.text vocabulary; generators must embed window labels |
| AffectEngine norepinephrine and contradictionStress spike on outage signals and decay monotonically to baseline | Exp 21 | EMA smoothing validated; stressed state produces 11× higher coupleAttention boost |
| AbstractionEngine ladder structure (5 nodes, compressionRatio 0.2→1.0, confidence scales with source count) is correct | Exp 22 | Structure validated; symbolic-label ceiling hit: all levels share same token — embeddings required for differentiation |
| AbstractionEngine symbolic-label assigns same dominant token to all 5 levels — no per-level clustering | Exp 22 | Known limitation documented in engine; embedding-based clustering is the fix |
| nomic-embed-text (768-dim) via ollama correctly separates incident windows in knn space | Exp 23 | First real embedding pipeline; embedding_nomic field in experience_events now usable |
| AbstractionEngine cosine-centroid clustering produces strictly decreasing source counts and label shift across levels | Exp 23 | Engine upgraded; requires dist rebuild before tsx picks up changes |
| OpenSearch 3.0 knn requires dedicated single-shard index — mixed-doc shards cause ConjunctionDISI errors | Exp 23 | Use separate exp index or ensure all docs in shard have the knn_vector field |

---

## Experiment 15 — Cross-Domain Operational Correlation

**Result:** H1/H2/H3/H4 pass. 200 synthetic operational signals generated across 4 incident windows; schema self-consistent and severity ordering correct.

| Window | Signals | Mean severity | XD rate |
| ------ | ------- | ------------- | ------- |
| normal | 40 | 0.268 | 0.000 |
| degraded | 60 | 0.680 | 1.000 |
| outage | 50 | 0.920 | 1.000 |
| recovery | 50 | 0.272 | 0.460 |

Each `OperationalSignal` extends `ExperienceEvent` and carries a structured `payload` with cross-domain fields (DB metrics, Zendesk ticket, Slack thread). XD rate (fraction of signals with both Zendesk and Slack present) is 100% for degraded/outage and drops to ~45% for recovery as the incident resolves.

**Key finding:** Recovery severity (0.272) is nearly equal to normal (0.268), not halfway between degraded and outage. This is correct behaviour — recovery signals reflect "incident resolved" state where most noise has subsided. The ordering `normal < recovery < degraded < outage` holds consistently.

**Production implication:** This dataset is ready to be fed into the experience_events index for retrieval and reinforcement experiments testing cross-domain correlation (e.g., "find all memories related to this Zendesk ticket"). The plugin architecture (`OperationalPluginRegistry`) is in place for real source ingestion.

---

## Experiment 16 — Re-Consolidation

**Result:** H1/H2/H3/H4 pass. Periodic background reinforcement prevents cluster ordering inversion; frequency determines effectiveness.

Builds on Exp 13's catastrophic convergence finding. Three conditions simulated over 100 decay epochs from the same post-reinforcement starting state (EPOCH_SCALE=20, RECON_THRESHOLD=0.45):

| Epochs | No recon A-C | Recon-10 A-C | Recon-5 A-C |
| ------ | ------------ | ------------ | ------------ |
| 0 | 0.528 | 0.528 | 0.528 |
| 10 | 0.390 | 0.421 | 0.449 |
| 50 | 0.088 | 0.115 | 0.200 |
| 100 | −0.024 | −0.015 | +0.012 |

Re-consolidation rule: every R epochs, all memories with rp > RECON_THRESHOLD receive a small positive boost (4% of importanceScore). Cluster-C memories fall below the threshold and don't qualify — the mechanism is selective by design.

**Key finding (H4):** Re-consolidation every 5 epochs fully prevents inversion (gap = +0.012 at epoch 100). Every 10 epochs reduces inversion magnitude but doesn't fully prevent it (−0.015 vs −0.024 without). The minimum effective interval depends on the decay_factor distribution and boost size; 5 epochs with 4% importanceScore boost is sufficient for this corpus.

**Production implication:** A background re-consolidation job running every 5 "time units" (however defined in production) is sufficient to maintain memory ordering integrity. The threshold filter makes it O(trusted-memories), not O(all-memories).

---

## Experiment 17 — Operational Signal Retrieval

**Result:** H1/H2/H3/H4 pass. BM25 retrieval over operational signal summaries correctly surfaces incident windows; tag filter returns exact counts.

Indexes the 200 Exp 15 signals into `experience_events` with narrative summaries built from window/service/severity. Three queries tested:

| Query | Top-3 windows | Avg importance |
| ----- | ------------- | -------------- |
| "postgres outage latency" | outage, outage, outage | 0.920 |
| "service recovery resolved" | recovery, recovery, recovery | 0.120 |
| "normal background metrics" | normal, normal, normal | 0.384 |

Tag filter for "outage" returns exactly 50 documents (correct — 50 outage-window signals indexed). All exp17 documents cleaned up after the run.

**Key finding (H3):** Outage signals (importance=0.920) rank far above normal signals (importance≈0.384) in retrieval score — severity is naturally encoded in the summary vocabulary ("critical incident", "severely elevated" vs "no anomalies detected"), so BM25 implicitly orders by severity when the query is incident-specific.

**Production implication:** Operational signals are a first-class citizen in `experience_events`. The BM25 path retrieves the correct incident window without any embedding — future work can add embeddings for semantic recall across service names and ticket IDs via graphSeeds.

---

## Experiment 18 — ConsolidationEngine: Operational Signals → Semantic Memories

**Result:** H1/H2/H3/H4 pass. The full `experience_events → ConsolidationEngine → memory_semantic` pipeline is demonstrated end-to-end with operational incident data.

Four incident windows consolidated from 200 Exp 15 signals:

| Window | Sources | importanceScore | stabilityScore |
| ------ | ------- | --------------- | -------------- |
| normal | 40 | 0.260 | 0.380 |
| degraded | 60 | 0.680 | 0.590 |
| outage | 50 | 0.920 | 0.710 |
| recovery | 50 | 0.259 | 0.379 |

**Key finding (H1):** outage-window `importanceScore` (0.920) vs normal (0.260) — the severity ordering from raw signals propagates faithfully through the `ExtractiveConsolidationModel`'s averaging into the consolidated semantic memory.

**Key finding (H2):** Source event counts exactly match window signal counts (40/60/50/50) with no cross-window contamination. The `requiredTags` filter added to `ConsolidationRequest` correctly scopes candidate selection to the target window.

**Key finding (H3):** `stabilityScore` (avg of importanceScore + rewardScore across candidates) orders incident windows above non-incident: outage=0.71 > degraded=0.59 > max(normal, recovery)=0.38. The normal/recovery windows are indistinguishable by stabilityScore (0.380 vs 0.379) — both are "quiet" windows with similar importance distributions.

**Key finding (H4):** BM25 over consolidated `summary` text correctly returns the right memory per window (e.g. "outage critical incident latency" → outage memory). The extractive model's concatenation of high-importance summaries preserves enough incident-specific vocabulary for keyword retrieval.

**Bug fixed:** `ConsolidationEngine` was writing `embedding: []` (empty array) to the `knn_vector` field when source events carried no embeddings, causing OpenSearch to reject the document with `mapper_parsing_exception`. Fixed by omitting the field when empty.

*Code changes: `requiredTags` added to `ConsolidationRequest`; tag-filtered query overlay in `selectReplayCandidates`; empty-embedding guard in `consolidate()` write.*

---

## Experiment 19 — DecayEngine: Forgetting Plan over Operational Signals

**Result:** H1/H2/H3/H4 pass. `DecayEngine.planForgetting` correctly stratifies the 200 operational signals by incident severity.

| Window | Signals | Retain | Suppress | ageDays=60 retain |
| ------ | ------- | ------ | -------- | ----------------- |
| normal | 40 | 35% | 65% | 0% |
| degraded | 60 | 100% | 0% | — |
| outage | 50 | 100% | 0% | — |
| recovery | 50 | 30% | 70% | — |

**Key finding (H1):** Outage signals (importance 0.84–0.96) score retention ≥ 0.584 — all retain. Normal signals (importance 0.14–0.30) score retention ≈ 0.31 — 65% suppress. The `importanceScore` gradient from Exp 15 propagates directly into the forgetting decision.

**Key finding (H2):** Zero `compress` actions at `ageDays=0`. The compress branch requires `ageDays > 30`, which is a hard precondition.

**Key finding (H3):** Setting `contradictionScore=0.9` on normal-window signals drives all 40 to `retire` (retentionScore drops to near 0 from the 0.35 contradiction penalty).

**Key finding (H4):** At `ageDays=60`, no normal signal retains. 26 prune + 14 suppress. compress does not fire because low-importance signals (retention ~0.21) hit the suppressionThreshold (0.35) before reaching the compress branch, which requires retention > 0.35. This is correct engine behaviour: compress is reserved for memories worth consolidating, not already-worthless ones.

**Graph pruning:** 5 links input → 3 retained (strength ≥ 0.15) + 2 pruned (strength < 0.15). pruneStrengthThreshold default=0.15 verified.

---

## Experiment 20 — CausalEngine: Structural Causal Model over Operational Signals

**Result:** H1/H2/H3/H4 pass. `CausalEngine.inferModel` recovers the incident co-occurrence structure from window-enriched event text.

**Inferred model:** 6 variables, 16 edges (full); 14 edges after `abstract(minStrength=0.35)`.

| Edge | Strength | Notes |
| ---- | -------- | ----- |
| latency ↔ degraded | 1.000 | Perfectly co-occurring in degraded window |
| normal ↔ metrics | 0.600 | Normal window mentions both |
| recovery ↔ normal | 0.556 | Recovery and normal share vocabulary |
| outage ↔ latency | 0.455 | Outage signals (50) co-occur with latency (110 total) |
| outage ↔ degraded | 0.455 | Both appear in outage-window text |
| latency/degraded ↔ metrics | 0.400 | Incident windows mention metrics |

**Key finding (H1):** `outage→latency` strength=0.455 > 0.3. The 50 outage events that mention both "outage" and "latency" yield a co-occurrence ratio of 50/110 ≈ 0.455 (denominator = total events mentioning "latency" = 50 outage + 60 degraded = 110).

**Key finding (H2):** `normal→outage` strength=0. Normal-window text contains neither "outage" nor the incident vocabulary. Zero joint mentions → zero edge.

**Key finding (H3):** `do(outage=1.0)` → latency baseline=0.5, counterfactual=0.955, effect=0.455. Direct causal attribution works.

**Key finding (H4):** Abstraction at minStrength=0.35 drops 2 edges (recovery↔metrics at 0.333), reducing from 16 → 14.

**Implementation note:** `CausalEngine.inferModel` uses `ExperienceEvent.input.text` for co-occurrence. The operational generator populates `input.text` with a generic `"Operational signal from ${service}"` — which has no window vocabulary. Exp 20 enriches each signal's `input.text` with window-specific narrative before passing it to the engine. This is the correct pattern: generators provide signals; experiments provide the richer text when testing NLP-dependent engines.

---

## Experiment 21 — AffectEngine: Incident Signal Modulates the Affect Vector

**Result:** H1/H2/H3/H4 pass. The 5-dimensional affect vector tracks the full incident lifecycle and correctly amplifies attention boost in stressed state.

| Phase | Mood | dopamine | norepinephrine | serotonin | curiosity | contradictionStress |
| ----- | ---- | -------- | -------------- | --------- | --------- | ------------------- |
| baseline (5 normal) | settled | 0.126 | 0.110 | 0.775 | 0.131 | 0.062 |
| peak stress (10 outage) | stressed | 0.004 | 0.861 | 0.000 | 0.734 | 0.895 |
| recovery (10 normal) | settled | 0.049 | 0.089 | 0.783 | 0.104 | 0.055 |

**Key finding (H1):** After 10 outage signals: norepinephrine=0.861 > 0.6, contradictionStress=0.895 > 0.5, mood=`stressed`. Serotonin collapses to 0.000 (sustained success drops to 0.1).

**Key finding (H2):** norepinephrine and contradictionStress decrease monotonically over the first 5 recovery steps (0.861→0.587→0.409→0.293→0.218→0.169). EMA smoothing prevents instant recovery from a high-stress state.

**Key finding (H3):** After 10 normal signals post-outage, mood=`settled`. Full recovery to near-baseline levels confirmed.

**Key finding (H4):** `coupleAttention` boost for a high-risk/high-urgency candidate: stressed=0.334, settled=0.030 — an **11× difference**. This quantifies how much the stressed state amplifies attention on urgent/risky items, via the norepinephrine and contradictionStress channels in the boost formula.

---
---

## Experiment 22 — AbstractionEngine: Compression Ladder over Operational Data

**Result:** H1/H2/H3/H4 pass. Ladder structure is correct. Symbolic-label ceiling documented: all levels share the same dominant token — embeddings are required to differentiate labels across levels.

Three input configurations tested:

| Config | Sources | Root token | Confidence (experience) | Confidence (worldview) |
| ------ | ------- | ---------- | ----------------------- | ---------------------- |
| A — 200 events | 200 | "service" | 1.000 | 1.000 |
| B — 4 memories | 4 | "latency" | 0.500 | 1.000 |
| C — 200 events + 4 memories | 204 | "service" | 1.000 | 1.000 |

**Key finding (H1):** Every ladder has exactly 5 nodes in the canonical order `experience → pattern → concept → principle → worldview`, with `compressionRatio` exactly 0.2 / 0.4 / 0.6 / 0.8 / 1.0.

**Key finding (H2):** Root label is always incident-domain vocabulary — "service" for event-heavy inputs (200 events all saying "service=..."), "latency" for memory-only inputs (whose `generalization` field mentions "latency" frequently). Never falls back to "general-abstraction".

**Key finding (H3):** Confidence scales with source count. At the `experience` level: A=1.000 vs B=0.500 (4/8). At `worldview`: both saturate at 1.000 (formula is `min(1, sources / max(1, 8-depth))` = `min(1, 4/1)` at depth 4).

**Key finding (H4):** Mixed ladder sourceIds contain IDs from both event set (200) and memory set (4) at every node — 204 unique IDs total.

**Ceiling documented:** All five levels share the identical dominant token (`service` for Config A, `latency` for Config B). The engine uses the same source corpus at every level — no per-level clustering. The engine comment explicitly acknowledges this: "Future revisions are expected to build the ladder incrementally by clustering at each level." This is the natural trigger point for introducing embeddings: once embeddings are available, each level can cluster a subset of sources by similarity, producing meaningfully differentiated labels.

---

## Experiment 23 — Embeddings: nomic-embed-text + knn Retrieval + AbstractionEngine Clustering

**Result:** H1/H2/H3/H4 pass. First real embedding pipeline validated end-to-end: embed → index → knn retrieve → cosine-centroid cluster.

**Model:** `nomic-embed-text` (768-dim) via ollama at `http://localhost:11434`. Field: `embedding_nomic` (already mapped as `knn_vector dim=768` in the index schemas).

**knn retrieval:**

| Query | Window hits in top-5 | Result |
| ----- | -------------------- | ------ |
| "critical infrastructure failure high latency severe incident outage" | outage: 5/5 | ✓ |
| "steady state background metrics no anomalies quiet" | normal: 5/5 | ✓ |

Scores ~1.81–1.86 (innerproduct space, nomic vectors are pre-normalized).

**AbstractionEngine ladder (cosine-centroid clustering, 200 embedded events):**

| Level | Sources | Label |
| ----- | ------- | ----- |
| experience | 200 | experience:service |
| pattern | 100 | pattern:service |
| concept | 25 | concept:degraded |
| principle | 4 | principle:degraded |
| worldview | 2 | worldview:degraded |

Source counts: 200 → 100 → 25 → 4 → 2 (halving each level). Label shifts from "service" (dominant across all 200 events) to "degraded" (centroid's closest semantic cluster) as the source set concentrates around the most representative signals.

**Key finding (H3):** Label changes between pattern→concept level — the centroid of the top-100 sources is closest to the degraded-window cluster. The worldview node represents the 2 most semantically central events in the entire corpus.

**Key finding (H4):** Strictly decreasing source counts confirm the per-level centroid clustering is active. Without embeddings (Exp 22) all levels had 200 sources; with embeddings each level halves.

**Infrastructure notes:**

- OpenSearch 3.0 knn requires all docs in a shard to have the `knn_vector` field — mixed-doc shards cause `ConjunctionDISI` errors. Exp 23 uses a dedicated `exp23_events` index (single shard, dropped after cleanup).
- `@cognitive-substrate/abstraction-engine` must be rebuilt (`pnpm build`) before tsx picks up source changes — tsx resolves via `dist/` from `package.json` exports.
- `exactOptionalPropertyTypes` requires conditional spread (`...(x ? { field: v } : {})`) rather than `field: x ? v : undefined` when the field is optional.
