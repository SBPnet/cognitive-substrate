---
title: Reinforcement Feedback for Operational Recommendations
chapter: 28
arc: operational-intelligence
status: draft
tags: [reinforcement, recommendations, confidence, feedback, operational-patterns]
---

# Chapter 28. Reinforcement Feedback for Operational Recommendations

*Chapter 28. Companion code: Stage 34 (reinforcement feedback worker). See also `docs/articles/article-35-reinforcement-feedback.md` for the engineering narrative.*

## 28.1 Feedback Requirement

Pattern detection produces diagnostic hypotheses. Operational intelligence requires a further capability: learning whether the associated recommendations improve outcomes.

The reinforcement feedback worker tracks recommendation outcomes and updates pattern confidence. This creates a feedback channel from incident response back into the pattern library.

## 28.2 Recommendation Outcome Model

Let a recommendation be represented as:

$$R = (r, p, c, a, t)$$

where $r$ is recommendation identifier, $p$ is pattern identifier, $c$ is match confidence, $a$ is recommended action set, and $t$ is timestamp.

An outcome is represented as:

$$O = (r, p, u, \Delta l, e)$$

where $u$ is outcome class, $\Delta l$ is optional latency delta, and $e$ is environment.

The shared recommendation identifier connects the initial pattern match to later feedback.

## 28.3 Outcome Signal

Outcome classes are mapped to numeric signals:

$$
o(u) =
\begin{cases}
1.0 & \text{if } u = success \\
0.5 & \text{if } u = partial \\
0.0 & \text{if } u = failure \\
0.5 & \text{if } u = ignored
\end{cases}
$$

The neutral treatment of ignored recommendations avoids interpreting absence of action as negative evidence.

## 28.4 Confidence Update

Pattern confidence is updated with an exponential moving average:

$$c_{t+1} = \alpha o(u) + (1 - \alpha)c_t$$

where $c_t$ is prior confidence, $o(u)$ is the outcome signal, and $\alpha$ is the learning rate.

The implementation clamps the result:

$$c_{t+1} \in [0.1, 0.99]$$

The lower bound preserves recoverability. The upper bound preserves falsifiability.

## 28.5 Dual Persistence

Outcome records are written to ClickHouse in `pattern_outcomes`. Updated confidence is written to the `operational_patterns` OpenSearch index.

This dual persistence reflects two access patterns. ClickHouse stores historical evidence for analysis. OpenSearch serves current pattern confidence to the detector.

## 28.6 Relationship to Policy Drift

The update mechanism parallels the policy drift model from Chapter 03, but applies it to operational pattern confidence rather than agent policy weights. In both cases, bounded updates preserve stability while allowing adaptation from observed outcomes.

## 28.7 Limitations

Outcome attribution is difficult. Latency improvement may result from an intervention, from unrelated load changes, or from natural recovery. The current update assumes feedback is already attributed to the recommendation. Stronger causal attribution remains future work.

---

*Companion article: `docs/articles/article-35-reinforcement-feedback.md`. Architecture documentation: `docs/architecture/clickhouse-telemetry.md` and `docs/architecture/operational-primitives.md`. Source code: `apps/workers/reinforcement/` and `packages/clickhouse-telemetry/`.*
