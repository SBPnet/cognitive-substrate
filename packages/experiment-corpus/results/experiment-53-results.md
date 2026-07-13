# Experiment 53 Results — Live Cross-Encoder Disambiguation + Feedback

**Status:** ALL PASS (2026-07-13)

- H1: TEXT_SIMILARITY model `bjcSXJ8BApsVNgKs81sB` (ms-marco-MiniLM-L-6-v2) deployed
- H2: outage raw score > normal + 0.5 (6.47 vs 4.79)
- H3: used FWA mean > 0
- H4: unused FWA mean ≤ 0

Production orchestrator wires reranker via `OPENSEARCH_RERANKER_MODEL_ID`.
