# Experiment 45 — Blog Telemetry Pipeline Integrity & Retrieval Quality

**Run date:** 2026-05-19  
**Index:** `experience_events` on thor (http://thor:9200)  
**Data source:** Real reader-behaviour events from bigpines.net  

## Summary

| Hypothesis | Result | Key metric |
|---|---|---|
| H1 — Pipeline integrity (≥100 docs, ≥3 event types) | **PASS** | 136 docs, 8 event types |
| H2 — Importance ordering (article_complete > page_view by ≥0.5) | **PASS** | 0.9357 vs 0.1000 (gap = 0.836) |
| H3 — kNN recall ≥80% across article slugs | **PASS** | 18/18 slugs (100%) |
| H4 — Multi-session articles have higher median importance | **FAIL** | multi=0.30, single=0.30 (no gap) |

## Data composition

136 total events, all ingested 2026-05-19. No multi-day spread yet.

**By event type:**

| Event type | Count | Mean importance |
|---|---|---|
| scroll_depth | 77 | 0.3153 |
| page_view | 25 | 0.1000 |
| article_complete | 14 | 0.9357 |
| copy_code | 8 | 0.6500 |
| time_on_page | 8 | 0.0000 |
| search_query | 2 | 0.6000 |
| focus_loss | 1 | 0.1750 |
| related_article_click | 1 | 0.4000 |

**Sessions:**  
- 3 real sessions from bigpines.net (9, 9, 8 events — all reading `ai-as-search` + one `experience-ingestion` hit)  
- 3 seeded exp45 sessions (`exp45-s1/s2/s3`) contributing the remaining 103 events across 18 article slugs

## H1 — Pipeline integrity

**PASS.** 136 docs, 8 distinct event types — well above the ≥100 / ≥3 thresholds. The Kafka → ingest-worker → OpenSearch path is confirmed live. All events are tagged as `environmental_observation` (single event_type) with blog event semantics encoded in the `tags` field (`event:*`, `article:*`, `engagement:*`).

## H2 — Importance ordering

**PASS.** The full ordering from `mapTelemetryToExperience()` is confirmed:

```
article_complete (0.9357) > copy_code (0.6500) > search_query (0.6000)
  > related_article_click (0.4000) > scroll_depth (0.3153)
  > focus_loss (0.1750) > page_view (0.1000) > time_on_page (0.0000)
```

The H2 criterion (article_complete > page_view by ≥0.5) holds with margin 0.836. `time_on_page` maps to 0.0 importance — these events carry no scalar signal and serve as temporal markers only.

## H3 — kNN recall

**PASS. 18/18 slugs recalled (100%).** The all-MiniLM-L6-v2 model (384-dim, deployed as `YIGOLZ4BgYB_vs2kWaTT`) correctly mapped "article completed about `<slug>`" query text to documents tagged `article:<slug>` in top-5 for every article in the index. The neural ingest pipeline is populating embeddings correctly at index time.

Notable: even articles with only `page_view`-level engagement (no completions) recalled correctly — the embedding is on the event text, not on engagement signal.

## H4 — Multi-session salience

**FAIL.** 5 articles appeared in ≥2 sessions vs 13 single-session articles, but median importance was identical (0.30 vs 0.30).

**Root cause:** `importance_score` is assigned per-event at ingest time based solely on event type — it has no cross-session memory. An article seen in 5 sessions accumulates 5× more scroll_depth events, but each scroll_depth still gets the same 0.15–0.55 range, so the median doesn't shift. The field that *should* express cross-session salience is `retrieval_priority`, written by the reinforcement engine after repeated retrieval. Since the reinforcement engine hasn't run against this real data yet, `retrieval_priority` is absent on these docs.

**Fix path:** H4 should be re-evaluated after the reinforcement engine runs a consolidation pass over `experience_events`. Alternatively, H4's proxy metric should be changed from `importance_score` to `retrieval_count` (which increments with each retrieval) or a per-article event-count ratio across sessions.

## Key findings

1. **Pipeline is fully operational** — Kafka ingest → OpenSearch → kNN retrieval works end-to-end with real data.
2. **Importance mapper is correct** — the 8-level ordering matches the mapper spec exactly, with `time_on_page` correctly yielding 0.0.
3. **kNN embeddings are healthy** — 100% recall on 18 slugs, including low-engagement articles, confirms the ML ingest pipeline is embedding all events regardless of importance.
4. **Cross-session salience requires reinforcement** — `importance_score` alone cannot distinguish frequently-visited articles; `retrieval_priority` from the reinforcement engine is the correct signal for H4. This experiment confirms the reinforcement engine is a required upstream dependency for multi-session salience measurement.
5. **Real data is sparse but structurally correct** — 3 real sessions vs 103 seeded events. The real sessions all converged on `ai-as-search`, which is expected for a new blog with one prominent post.

## Next steps

- Run reinforcement engine over `experience_events` and re-test H4 using `retrieval_priority`
- Accumulate more real sessions (target: 10+ distinct sessions across ≥5 articles) before re-running H4 on real data
- Consider adding a `session_count` field to `experience_events` aggregated view or `memory_semantic` to make cross-session salience directly queryable
