# Experiment 47 — Memory Critique Events (MCE) Pipeline

**Date**: 2026-05 (documented from run; results markdown backfilled 2026-07-10)
**Status**: ALL PASS

## Goal

Validate end-to-end Memory Critique Event handling: high/mid-confidence critiques
decrement `retrieval_priority`, raise suppression threshold, and cascade to
descendants at 50% attenuation.

## Hypotheses

| ID | Hypothesis | Result |
|----|-----------|--------|
| H1 | High-confidence critique (≥0.8) decrements retrieval_priority by ~-0.25 | **PASS** |
| H2 | Mid-confidence critique (0.5–0.79) decrements by ~-0.12 | **PASS** |
| H3 | suppression_threshold raised; last_critique_at written | **PASS** |
| H4 | Concept-level critique cascades to descendants at 50% attenuation | **PASS** |

## Key findings

1. Trust deltas match cascade constants (`TRUST_DELTA_HIGH` / `TRUST_DELTA_MID`).
2. Cascade attenuation is level-aware and does not over-suppress leaf memories.
3. Worker path (`cs-worker-memory-critique`) shares the same cascade module exercised here.

## Production implications

MCE is safe to leave enabled on thor. Monitor `memory.feedback` lag and
`last_critique_at` coverage on `memory_semantic`.
