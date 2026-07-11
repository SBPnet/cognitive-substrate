# Experiment 51 — Lucene 1-bit SQ vs float32 (OpenSearch 3.6)

**Date**: 2026-07-10
**Status**: ALL PASS
**Cluster**: thor OpenSearch 3.6.0

## Goal

After upgrading the lab to OpenSearch 3.6, compare lucene float32 HNSW against
lucene 1-bit Scalar Quantization (`encoder: { name: "sq", parameters: { bits: 1 } }`)
on a fresh index. Production indexes were not remapped.

Note: the blog-style `encoder.name: "binary"` mapping is rejected on 3.6;
`sq` with `bits: 1` is the working lucene path.

## Hypotheses

| ID | Hypothesis | Result | Value |
|----|-----------|--------|-------|
| H1 | float32 top-1 knn correct for all 4 windows | **PASS** | 4/4 |
| H2 | 1-bit SQ top-1 knn correct for all 4 windows | **PASS** | 4/4 |
| H3 | 1-bit SQ hybrid bool+knn+term works | **PASS** | 5/5 correct in top-5 |
| H4 | total store comparable (BBQ/float32 ≤ 1.15) at n=100 | **PASS** | ratio=1.045 |

## Key findings

1. Lucene 1-bit SQ preserves window recall and hybrid filtered search on 3.6.
2. At n=100 with text+vector docs, total index size is text-dominated; absolute
   32x vector savings will only show on larger / vector-heavy corpora.
3. Do not remap `experience_events` until a larger-scale size study lands.

## Production implications

Keep production knn mappings on float32 lucene for now. 1-bit SQ is validated
as a safe opt-in for new experiment indexes on OpenSearch 3.6.
