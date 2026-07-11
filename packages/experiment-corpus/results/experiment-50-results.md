# Experiment 50 — Real Blog Cross-Session Salience

**Date**: 2026-07-10
**Status**: ALL PASS

## Goal

Run the reinforcement engine over live `tags:blog` docs (excluding exp45-*
seeds and probe sessions) and confirm `retrieval_priority` encodes
cross-session salience on real reader traffic (Exp 45 H4 follow-up).

## Hypotheses

| ID | Hypothesis | Result | Value |
|----|-----------|--------|-------|
| H1 | retrieval_priority > 0 written to ≥1 real blog doc | **PASS** | reinforced 108 sampled docs |
| H2 | multi-session median rp > single-session median rp | **PASS** | multi=0.5596, single=0.4832 |
| H3 | Pearson r(rp, session_count) ≥ 0.5 | **PASS** | r=0.6781 |
| H4 | importance_score uncorrupted | **PASS** | maxDelta=0.000000 |

## Data

- Real blog docs with article tags: **697** across **37** articles
- Multi-session articles (≥2): **21**; single-session: **16**
- Reinforcement sample: up to 3 docs per article (**108** updates)

## Key findings

1. Live reader traffic shows the same salience pattern as Exp 46 seeded docs.
2. `retrieval_priority` is the correct cross-session signal on production data.
3. Sampling per article is required for wall-clock feasibility (`refresh: wait_for` per update).

## Production implications

Periodic reinforcement over blog-tagged `experience_events` should run in the
background worker path so salience stays current as sessions accumulate.
