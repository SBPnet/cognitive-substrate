# Evaluation Baseline

Status: baseline-passed

## retrieval

Fixture-level retrieval baseline for hybrid BM25+kNN+rerank. Replace with a labelled corpus for publication claims.

- passed: recall@3=1.0000 target>=1
- passed: mrr=1.0000 target>=1
- passed: ndcg@3=1.0000 target>=1

## consolidation

Replay fixture baseline for cluster compression and contradiction surfacing.

- passed: compression_ratio=0.3333 target>=0.33
- passed: contradiction_surface_rate=0.1667 target>=0.1

## policy-drift

Deterministic clamping baseline; longitudinal reward perturbation runs should replace the fixture.

- passed: max_clamped_delta=0.1000 target>=0.1
- passed: stability_retention=0.9000 target>=0.9

## pattern-transfer

Fixture-level SystemMapping transfer baseline; real transfer claims require two environment corpora.

- passed: zero_shot_hit_rate=0.5000 target>=0.5
- passed: precision_fixture=1.0000 target>=1

## multi-agent-specialization

Agent-role fixture baseline for paper Ch 4.9; production evidence requires repeated task traces.

- passed: role_coverage=1.0000 target>=1
- passed: arbitration_diversity=0.8000 target>=0.8

