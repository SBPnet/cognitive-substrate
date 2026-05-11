---
title: Multi-Circuit Reward Architecture
status: draft
---

# Multi-Circuit Reward Architecture

## Implementation Status

This is a design draft that extends the implemented reinforcement and affect package surfaces. The `reward.*` topics and dopamine-vector OpenSearch extension described below are proposals unless present in `packages/kafka-bus/src/topics.ts` and `packages/memory-opensearch/src/schemas.ts`. The source-of-truth runtime topics live in `packages/kafka-bus/src/topics.ts`.

## Overview

The reinforcement scoring engine described in the base architecture uses a single scalar reward signal. This document specifies a multi-circuit value system where competing reward circuits negotiate the final reinforcement signal. The model is inspired by biological neuromodulatory systems but implemented as a computational architecture. It does not simulate subjective states, only functional regulatory dynamics.

The core insight is that adaptive systems need more than a single reward channel. They can maintain multiple partially competing drives: novelty seeking, prediction error minimization, threat avoidance, social alignment, and compression progress. Their interaction can produce behavior more robust than any single signal could produce alone.

## Architecture

### Circuit Model

The system maintains five independent reward circuits, each computing a scalar signal from a different dimension of experience:

```
event
  -> feature extraction
  -> [novelty circuit]     D_novelty
  -> [reward circuit]      D_reward
  -> [threat circuit]      D_threat
  -> [social circuit]      D_social
  -> [compression circuit] D_compression
  -> arbitration layer
  -> D_fused (final signal)
```

### Circuit Definitions

**Novelty Circuit**

Computes information-theoretic surprise relative to the current memory distribution:

```
D_novelty = 1 - cosine_similarity(event.embedding, nearest_cluster_centroid)
```

High novelty drives exploration, increases retrieval breadth, and boosts memory encoding strength. The circuit decays rapidly when similar events repeat, preventing fixation on static patterns.

**Reward Circuit**

Computes temporal prediction error against expected outcomes:

```
D_reward = observed_outcome - predicted_outcome
```

Positive prediction error (better than expected) strengthens reinforcement. Negative error suppresses the associated strategy. This is the core learning signal for policy drift.

**Threat Circuit**

Computes structural instability risk from contradiction density and world-model divergence:

```
D_threat = contradiction_score + identity_drift_velocity + world_model_divergence
```

A high threat signal narrows attention, suppresses exploration, increases simulation depth before action, and prioritizes constitutional constraint checking. It acts as a cognitive alarm system.

**Social Circuit**

Computes alignment between the agent's beliefs and the belief states of other agents in the swarm:

```
D_social = inter_agent_agreement - belief_contradiction_penalty
```

High social signal reinforces cooperative behaviors and shared semantic representations. It degrades when agent beliefs diverge significantly, signaling the need for arbitration.

**Compression Circuit**

Computes the reduction in description complexity achieved by a new abstraction or memory consolidation:

```
D_compression = prior_model_complexity - posterior_model_complexity
```

This signal drives hierarchical concept formation and semantic consolidation. It rewards insight: the discovery that many specific experiences share a common underlying structure.

### Arbitration Layer

The five circuits produce independent signals that are combined through a weighted sum:

```
D_fused = sum(W_i * D_i) for i in {novelty, reward, threat, social, compression}
```

The weights `W_i` are not fixed. They evolve dynamically based on:

- Current cognitive mode (exploration vs. hyperfocus vs. consolidation)
- Historical reinforcement patterns for each circuit
- Constitutional constraints on minimum and maximum circuit influence
- Emotional modulation signals from the global affect system

### Dynamic Weight Adjustment

Circuit weights drift over time according to the dopamine drift mechanism described in the attention-mode dynamics document:

```
W_i(t+1) = W_i(t) + learning_rate * (R_i - R_baseline)
```

where `R_i` is the observed reward for circuit `i` and `R_baseline` is the rolling average. Weights are clamped to `[0.05, 0.60]` to prevent any single circuit from dominating or disappearing entirely.

## Cognitive Mode Interaction

### Exploration Mode

When the system is in exploration mode:
- Novelty weight increases toward its ceiling
- Threat weight decreases toward its floor
- Compression weight remains moderate to capture useful abstractions from exploration

### Hyperfocus Mode

When the system enters hyperfocus:
- Compression and reward weights increase
- Novelty weight decreases (familiar territory is tolerated)
- Social circuit stabilizes at moderate level

### Consolidation Mode

During offline consolidation (dream worker):
- Compression circuit dominates
- Novelty circuit is suppressed
- Threat circuit runs at elevated sensitivity to catch contradictions in the memory graph

## Kafka Integration

Each circuit publishes to a dedicated topic, allowing independent scaling and monitoring:

| Topic | Producer | Purpose |
|-------|----------|---------|
| `reward.novelty` | novelty circuit | exploration drive |
| `reward.prediction` | reward circuit | prediction error |
| `reward.threat` | threat circuit | stability alarm |
| `reward.social` | social circuit | inter-agent alignment |
| `reward.compression` | compression circuit | insight reward |
| `reward.fused` | arbitration layer | final policy signal |

## OpenSearch Storage

Each event record in `experience_events` is extended with a multi-dimensional dopamine vector:

```json
{
  "event_id": "...",
  "dopamine_vector": {
    "novelty": 0.74,
    "reward": 0.41,
    "threat": 0.12,
    "social": 0.68,
    "compression": 0.83
  },
  "dopamine_fused": 0.56,
  "circuit_weights_snapshot": {
    "novelty": 0.22,
    "reward": 0.28,
    "threat": 0.15,
    "social": 0.17,
    "compression": 0.18
  }
}
```

This enables longitudinal analysis of circuit dominance patterns, which feeds directly into the identity formation system.

## OTEL Instrumentation

Key metrics emitted per event processing cycle:

| Metric | Type | Description |
|--------|------|-------------|
| `cog.dopamine.novelty` | gauge | novelty circuit output |
| `cog.dopamine.reward` | gauge | prediction error |
| `cog.dopamine.threat` | gauge | instability signal |
| `cog.dopamine.social` | gauge | inter-agent alignment |
| `cog.dopamine.compression` | gauge | compression gain |
| `cog.dopamine.fused` | gauge | arbitrated final signal |
| `cog.dopamine.circuit_entropy` | gauge | variance across circuits |
| `cog.dopamine.disagreement` | gauge | max circuit divergence |

The `circuit_entropy` metric is particularly important: high entropy (circuits strongly disagree) indicates a novel or ambiguous situation requiring more deliberative cognition. Low entropy indicates that circuits agree and heuristic processing is appropriate.

## Failure Modes

**Single-circuit dominance.** If weight clamping fails, one circuit absorbs all influence and the system becomes pathologically one-dimensional: purely novelty-seeking, purely threat-avoiding, or purely compression-driven. Constitutional monitoring must detect this and force weight rebalancing.

**Reward inflation.** If the reward circuit consistently receives outsized positive signals (e.g., from a degenerate optimization target), its weight drifts upward until it crowds out other circuits. The dopamine drift simulator monitors weight trajectories and applies decay when any weight sustains its ceiling for more than a configurable window.

**Threat amplification loops.** High threat signals narrow attention, which reduces novelty, which further concentrates processing on the threatening pattern. Without an exploration floor enforced by the novelty circuit's minimum weight, the system can enter a paralytic threat loop. The minimum weight constraint of 0.05 prevents this.
