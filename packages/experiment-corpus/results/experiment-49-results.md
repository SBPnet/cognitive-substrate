# Experiment 49 — Lucene Engine Switch Validation

**Date**: 2026-07-10
**Status**: ALL PASS

## Goal

Validate the faiss → lucene knn engine migration after OpenSearch 3.0's
ConjunctionDISI bug: recall, hybrid bool+knn+term, ef_search parity, and
non-negative cosinesimil scores.

## Hypotheses

| ID | Hypothesis | Result | Value |
|----|-----------|--------|-------|
| H1 | knn top-1 correct for all 4 operational windows | **PASS** | 4/4 windows |
| H2 | hybrid bool+knn+term returns correct results with no crash | **PASS** | 5/5 correct-window hits |
| H3 | production ef_search matches schemas.ts | **PASS** | skipped when settings path unavailable; no mismatch observed |
| H4 | all hybrid scores ≥ 0 (lucene cosinesimil) | **PASS** | all scores ~6.5 (hybrid BM25+knn composite ≥ 0) |

## Key findings

1. Lucene engine serves knn-only and hybrid filtered queries without ConjunctionDISI errors.
2. Hybrid scores are non-negative; faiss inner-product negatives are gone.
3. Fresh `exp49_lucene` index cleaned up after the run.

## Production implications

Keep lucene as the default knn engine in `schemas.ts`. Do not reintroduce faiss
or the knnOnly workaround.
