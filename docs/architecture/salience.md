---
title: Salience Propagation
category: architecture
status: draft
tags: [salience, retrieval, attention, reinforcement]
---

# Salience Propagation

Salience propagation is the substrate mechanism that determines which memories, traces, goals, and agent proposals compete for limited cognitive budget. It unifies importance scoring, novelty, reward history, contradiction risk, goal relevance, recency, and policy bias into a single routing surface.

## Role In The Substrate

Salience is not a presentation feature. It is an infrastructure signal used by ingestion, retrieval, arbitration, consolidation, and observability. The same experience can be stored permanently in the episodic truth layer while being suppressed, amplified, or routed differently in active cognition.

## Signal Inputs

| Signal | Source | Purpose |
|--------|--------|---------|
| Importance | ingestion and consolidation | initial retention priority |
| Novelty | embedding distance and cluster divergence | exploration pressure |
| Reward | reinforcement engine | future recall and policy bias |
| Contradiction risk | memory graph and critic output | stability protection |
| Goal relevance | goal system | long-horizon prioritization |
| Recency and decay | memory lifecycle layer | temporal access control |
| Policy bias | policy engine | learned retrieval preference |

## Event Model

| Topic | Purpose |
|-------|---------|
| `salience.scored` | Emits computed salience for a memory, proposal, or trace |
| `salience.propagated` | Emits downstream salience changes after reinforcement or consolidation |
| `salience.suppressed` | Records active suppression or decay decisions |

## OpenTelemetry Conventions

| Attribute | Meaning |
|-----------|---------|
| `cog.salience.score` | final salience score |
| `cog.salience.novelty` | novelty contribution |
| `cog.salience.reward` | reward contribution |
| `cog.salience.goal_relevance` | active-goal contribution |
| `cog.salience.decay` | decay or suppression contribution |
| `cog.salience.route` | selected route: focus, background, suppress, consolidate |

## Failure Modes

Runaway salience can produce retrieval echo chambers and over-consolidation. Salience collapse can suppress useful memory and degrade continuity. The constitutional stability layer should monitor salience entropy, long-tail retrieval access, and repeated dominance by any single scoring factor.
