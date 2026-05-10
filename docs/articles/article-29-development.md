# Stage 28: Developmental Cognition

*This article accompanies Stage 28 of the cognitive-substrate project. It describes the development engine that models staged capability maturation, curriculum emergence, and phase transitions in reasoning capability.*

## Intelligence as growth

The architecture now contains many capabilities, but capability availability should not imply capability maturity. A system may need to develop competence gradually as experience, abstraction, and calibration accumulate.

Stage 28 introduces developmental cognition: the representation of growth stages in the system's own capabilities.

## Capability stages

The development engine tracks which cognitive subsystems are available, reliable, and trusted. A capability can exist in code but remain gated until evidence supports its use in higher-stakes contexts.

This separates implementation from developmental readiness.

## Curriculum emergence

The system can identify task sequences that build competence. Easier tasks establish baseline patterns. Harder tasks unlock when the system shows adequate calibration, memory quality, and policy stability.

Curriculum is therefore not only externally assigned. It can emerge from the system's own uncertainty and performance history.

## Phase transitions

Some improvements are gradual. Others appear as phase transitions when several prerequisites align: memory quality, abstraction depth, causal models, and meta-cognitive calibration.

The development engine records these transitions so later analysis can distinguish ordinary learning from capability maturation.

## Progressive unlocking

Higher cognitive subsystems can be progressively unlocked. Autonomy, self-modification, open-ended exploration, and stronger automation may require evidence that foundational systems are stable.

This creates a safety-aware growth path.

## Artifacts (Tier A)

**Stage covered:** 28, Developmental Cognition.

**Packages shipped:** `packages/development-engine/`.

**Runtime role:** The engine models capability maturation, curriculum emergence, phase transitions, and progressive unlocking of higher subsystems.

**Tier B:** Runtime evidence requires longitudinal performance, calibration, and capability-use records.

**Quantitative claims:** Claims about staged maturation remain pending longitudinal validation.

*Source code: `packages/development-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/22-developmental-cognition.md`.*
