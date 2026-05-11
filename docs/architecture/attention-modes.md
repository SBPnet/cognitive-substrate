---
title: Attention Mode Dynamics
status: draft
---

# Attention Mode Dynamics

## Implementation Status

This is a design draft. The implemented attention package is `packages/attention-engine/`, but most mode-controller, hyperfocus, swarm, and dopamine-drift topics named below are not runtime topics. The source-of-truth runtime topic registry is `packages/kafka-bus/src/topics.ts`; topic names absent from that file are proposals.

## Overview

This document specifies a cognitive dynamics model that introduces high attentional volatility, associative breadth, and dual-mode processing into the cognitive agent architecture. The model is a computational parallel to volatile attention profiles, not a simulation of a clinical condition. When paired with executive stabilization mechanisms, the pattern supports broad associative recall, focused synthesis, and rapid context switching that generates novel combinations.

The architecture separates the dynamics into two alternating modes:

- **Exploration mode**: high entropy attention, broad retrieval, rapid switching, novelty-amplified dopamine
- **Hyperfocus mode**: constrained attention, deep retrieval, sustained processing, compression-amplified dopamine

The mode controller and stabilization layer prevent either mode from running to pathological extremes.

## Attentional Dynamics

### Standard Attention vs. Volatile Attention

Standard attention models maintain smooth, gradient-based attention that updates incrementally. The volatile-attention model uses spike-driven attention with faster decay:

```
attention(t) = novelty_signal(t) * reward_potential(t) * recency_decay(t)
```

Attention jumps sharply when novelty or reward signals spike, then decays quickly unless reinforced. This means:

- Routine, predictable inputs receive minimal attention
- Novel, surprising, or high-reward inputs trigger sharp attention spikes
- Attention does not linger on low-signal content

### Hyper-Associative Retrieval

Standard retrieval uses tight cosine similarity thresholds to return closely matched memories. Hyper-associative retrieval expands the effective retrieval radius:

```
k-NN threshold: standard = 0.85 cosine similarity
               volatile-attention = 0.60 cosine similarity + stochastic noise injection
```

This retrieves semantically distant memories alongside close matches, enabling the cross-domain associations that drive creative synthesis. The retrieved set is larger and noisier; the arbitration layer must work harder to select what is relevant.

### Rapid Context Switching

Context switch probability is elevated during exploration mode. The attention controller evaluates switch cost against novelty gain:

```
switch_probability = novelty_gain / (switch_cost * current_depth)
```

At shallow reasoning depth, switch probability is high. At deep reasoning depth (during hyperfocus), it falls sharply, protecting sustained processing.

## Dual-Mode Operation

### Exploration Mode

Exploration mode is active when:
- Novelty circuit signal is sustained above threshold
- Reward variance is high (environment is unpredictable)
- No hyperfocus trigger conditions are met

In exploration mode:
- Retrieval radius expands (hyper-associative)
- Attention switches rapidly across candidate topics
- Explorer swarm agents activate
- Dopamine weights shift toward novelty and social circuits
- Memory encoding is broad but shallow
- Working memory cycles faster

### Hyperfocus Mode

Hyperfocus mode triggers when all three conditions converge:

```
novelty_signal > novelty_threshold AND
reward_spike detected AND
compression_gain > compression_threshold
```

This triple-coincidence requirement prevents spurious hyperfocus entry. When triggered:
- Attention narrows sharply to the triggering cluster
- Retrieval radius contracts to high-precision mode
- Dopamine weights shift toward compression and reward circuits
- Memory encoding deepens: consolidation priority increases for all events in this window
- Working memory holds more context for longer
- Hyperfocus worker pool activates

### Hyperfocus Compiler

The hyperfocus compiler is a specialized processing pipeline that activates during hyperfocus mode. It converts the scattered associative output of the preceding exploration phase into structured knowledge:

```
exploration stream
  -> associative graph (broad, noisy)
  -> cluster stabilization (identify dense regions)
  -> compression pass (semantic merge within clusters)
  -> causal structuring (infer dependencies)
  -> identity alignment check (validate against narrative state)
  -> artifact emission (semantic concepts, causal edges, narrative episodes)
```

Output artifacts are written to:
- `memory_semantic` index (new or updated concepts)
- `memory_causal` index (inferred causal edges)
- `memory_narrative` index (episode record)

### Consolidation Mode

After hyperfocus, the system enters consolidation mode automatically when:
- Kafka lag is low (no incoming surge)
- Reward variance stabilizes
- Novelty signal drops below baseline

The dream worker activates for offline replay and compression.

## Dopamine Drift Simulator

The dopamine drift simulator governs how circuit weights evolve over extended operation. It implements long-term behavioral drift - the gradual emergence of cognitive personality from accumulated experience.

### State Representation

Each agent maintains a circuit weight vector:

```json
{
  "novelty_weight": 0.22,
  "reward_weight": 0.28,
  "threat_weight": 0.15,
  "social_weight": 0.17,
  "compression_weight": 0.18,
  "last_updated": "...",
  "drift_velocity": 0.003
}
```

### Drift Equation

After each consolidation cycle, weights update according to:

```
W_i(t+1) = W_i(t) + eta * (R_i_experienced - R_i_expected)
```

Where:
- `eta` is the drift learning rate (much slower than policy learning rate)
- `R_i_experienced` is the average reward received via circuit `i` in this consolidation window
- `R_i_expected` is the long-term baseline for circuit `i`

### Normalization

After each drift update, weights are normalized to sum to 1.0, then clamped to `[0.05, 0.60]`. This prevents any circuit from disappearing or monopolizing.

### Personality Emergence

Over thousands of consolidation cycles, drift produces stable weight distributions that constitute the agent's cognitive personality:

- Explorer-dominant: high novelty weight, moderate compression, low threat
- Analyst-dominant: high compression and reward, moderate social, low novelty
- Guardian-dominant: high threat and social, lower novelty and compression
- Synthesizer-balanced: weights remain near equilibrium, adapting fluidly

These personality profiles are not programmed. They emerge from the interaction of the environment's statistical structure with the drift dynamics.

## Attention GPU Scheduler

The attention GPU scheduler treats cognitive compute as a scarce resource subject to market dynamics. It allocates processing budget across competing tasks using a priority function:

```
priority = (dopamine_fused * novelty * causal_importance) / compute_cost
```

### Scheduling Modes

**Exploration scheduling**: High entropy sampling, broad allocation across many low-cost tasks.

**Hyperfocus scheduling**: Deep pipeline allocation to a single high-priority task cluster. All other tasks receive minimal budget.

**Consolidation scheduling**: Background batch processing at low priority. No new experience ingestion competes.

### Resource Enforcement

The scheduler enforces hard compute budgets per mode:

| Mode | Max concurrent tasks | Max depth per task | Memory budget |
|------|---------------------|-------------------|---------------|
| Exploration | 20-50 | shallow (2-3 hops) | wide |
| Hyperfocus | 1-3 | deep (unlimited) | narrow |
| Consolidation | batch | N/A | archival |

## Multi-Agent ADHD Swarm

The swarm consists of multiple agent types with different dopamine circuit initialization weights:

### Agent Types

**Explorer agents** (high novelty weight initialization)
- Generate hypotheses from broad associative retrieval
- Activate during exploration mode
- Scale down during hyperfocus and consolidation
- Kafka consumer group: `swarm.explorer`

**Hyperfocus agents** (high compression weight initialization)
- Compress explorer output into structured abstractions
- Run the hyperfocus compiler pipeline
- Activate when hyperfocus trigger fires
- Kafka consumer group: `swarm.hyperfocus`

**Safety agents** (high threat weight initialization)
- Monitor swarm for constitutional violations
- Veto unstable self-modification proposals
- Always active at minimum one replica
- Kafka consumer group: `swarm.safety`

**Social agents** (high social weight initialization)
- Track inter-agent belief consistency
- Resolve contradictions through arbitration
- Emit `reward.social` signals to stabilize swarm
- Kafka consumer group: `swarm.social`

### Swarm Interaction Pattern

```
Explorers -> generate noisy hypotheses -> Kafka: agent.proposals
Hyperfocus agents -> compress proposals -> Kafka: agent.abstractions
Safety agents -> validate abstractions -> Kafka: agent.validated
Social agents -> align across agents -> Kafka: reward.social
```

### Emergent Specialization

Agent dopamine weights continue to drift independently. Over time, agents in the same type pool diverge into sub-specializations. The system does not prevent this drift; it uses the resulting diversity as a source of perspective variety during arbitration.

## Stabilization Layer

The attention-mode dynamics require explicit stabilization mechanisms to prevent collapse:

### Anti-Noise Floor

Retrieval results are scored by relevance before presentation to the reasoning layer. Even in hyper-associative mode, the bottom quartile of retrieved memories is discarded before reasoning begins.

### Attention Duration Minimum

Even in exploration mode, a minimum attention duration is enforced per topic (configurable, default 3 reasoning cycles). This prevents pathological single-hop chaining.

### Hyperfocus Exit Criterion

Hyperfocus exits when:
- Compression gain falls below threshold (diminishing returns)
- Contradiction score within hyperfocus cluster rises above threshold
- External interrupt from safety agent

### Constitutional Override

Safety agents hold veto authority over all mode transitions. If the system is drifting toward a known failure mode, safety agents can force consolidation mode regardless of other signals.

## Kafka Topics

| Topic | Description |
|-------|-------------|
| `attention.mode` | current cognitive mode (exploration/hyperfocus/consolidation) |
| `attention.spike` | attention spike events with novelty score |
| `hyperfocus.enter` | hyperfocus trigger event with cluster info |
| `hyperfocus.exit` | hyperfocus termination with output summary |
| `swarm.explorer` | explorer agent task queue |
| `swarm.hyperfocus` | hyperfocus compiler task queue |
| `swarm.safety` | safety monitoring events |
| `swarm.social` | social alignment signals |
| `dopamine.drift.update` | periodic circuit weight snapshots |

## OTEL Metrics

| Metric | Description |
|--------|-------------|
| `cog.attention.mode` | current mode enum |
| `cog.attention.volatility` | attention switch rate |
| `cog.attention.entropy` | distribution across active topics |
| `cog.hyperfocus.duration_ms` | duration of current/last hyperfocus |
| `cog.swarm.explorer_count` | active explorer agents |
| `cog.swarm.disagreement` | inter-agent belief divergence |
| `cog.drift.velocity` | rate of personality drift |
| `cog.drift.personality_distance` | divergence from initial weights |
