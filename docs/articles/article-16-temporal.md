# Stage 15: Temporal Cognition

*This article accompanies Stage 15 of the cognitive-substrate project. It describes the temporal engine that represents urgency, planning horizon, subjective computational time, and episodic sequence.*

## Cognition across time

Attention decides what matters now. Temporal cognition decides how now relates to later. A system that cannot represent time treats all decisions as immediate decisions, even when consequences unfold over minutes, weeks, or many sessions.

Stage 15 introduces multi-timescale planning and urgency modeling.

## Planning horizons

The temporal engine represents micro, short, mid, long, and meta horizons. These horizons align with the goal hierarchy introduced earlier, but they apply more broadly to planning, memory retrieval, and compute allocation.

A micro-horizon decision selects the next step. A long-horizon decision preserves strategic direction. A meta-horizon decision governs how the system reasons about horizons themselves.

## Urgency gradients

Urgency is not a binary flag. The engine computes urgency gradients so events can become more or less demanding as deadlines approach, risks grow, or opportunities decay.

This allows attention and arbitration to distinguish an important but slow-moving goal from a lower-value signal that requires immediate action.

## Subjective computational time

The system can spend more or less inference depth on a moment depending on density and risk. A dense or high-stakes situation may justify slower, deeper reasoning. A routine situation may use a fast path.

This is a computational analogue to variable subjective time: the architecture allocates more internal processing to moments that demand it.

## Episodic sequencing

Temporal cognition also organizes events into sequences. Sequence matters because causes, plans, and narratives depend on order.

By representing temporal structure explicitly, later causal and narrative systems can reason over how situations unfolded rather than only which facts were present.

## Artifacts (Tier A)

**Stage covered:** 15, Temporal Cognition.

**Packages shipped:** `packages/temporal-engine/`.

**Runtime role:** The engine provides planning horizons, urgency gradients, variable inference depth signals, and episodic sequencing.

**Tier B:** Runtime evidence requires integration with goals, attention, and agent-loop scheduling.

**Quantitative claims:** Claims about planning quality or urgency calibration remain pending task evaluation.

*Source code: `packages/temporal-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/09-temporal-cognition.md`.*
