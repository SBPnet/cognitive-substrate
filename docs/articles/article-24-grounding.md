# Stage 22: Grounded Cognition

*This article accompanies Stage 22 of the cognitive-substrate project. It describes the grounding engine that connects internal predictions and memories to external telemetry and sensor-like signals.*

## The problem of detached cognition

An agent can become coherent internally while drifting away from the world it is meant to model. Memories, narratives, and goals can reinforce one another even when external conditions change.

Stage 22 introduces grounding: a feedback path from telemetry and environmental signals into cognition.

## Telemetry as experience

The grounding engine treats external telemetry and sensor-like observations as experience events. These events enter the same memory and reinforcement substrate as agent actions.

This extends the architecture from self-observation to world observation.

## Prediction-error feedback

Grounding compares world-model predictions against observed outcomes. Prediction error becomes a signal for memory correction, policy adjustment, and model calibration.

A system that predicts confidently and observes contradiction should not simply continue. It should update the structures that made the prediction plausible.

## World-model correction

The engine routes grounded observations back into the world model. Corrections can adjust confidence, update causal assumptions, or mark unresolved environmental uncertainty.

This gives the world model an empirical anchor rather than relying only on text-derived plausibility.

## Active inference probes

The system can generate probes: small actions or observations intended to reduce uncertainty. A probe is not primarily an attempt to achieve a goal; it is an attempt to learn enough to act better.

Active probing connects grounding to curiosity and causal intelligence.

## Artifacts (Tier A)

**Stage covered:** 22, Grounded Cognition.

**Packages shipped:** `packages/grounding-engine/`.

**Runtime role:** The engine ingests telemetry as experience, computes prediction error, corrects world-model assumptions, and supports active inference probes.

**Tier B:** Runtime evidence requires external telemetry streams and recorded world-model predictions.

**Quantitative claims:** Claims about prediction-error reduction remain pending empirical validation.

*Source code: `packages/grounding-engine/`. Architecture documentation: `docs/architecture/otel-observability.md`. Companion paper chapter: `docs/paper/16-grounded-cognition.md`.*
