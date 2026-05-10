# Stage 26: Dreaming System

*This article accompanies Stage 26 of the cognitive-substrate project. It describes the dream engine that performs offline synthetic replay, adversarial imagination, abstraction recombination, and memory stress testing.*

## Offline imagination

Consolidation replays actual experience. Curiosity identifies unknowns. Stage 26 combines these capabilities into offline synthetic replay: the system generates hypothetical experiences to test abstractions, policies, and plans.

The dreaming system is not a claim about biological dreaming. It is a computational mechanism for offline recombination and stress testing.

## Synthetic replay

The engine samples memories, goals, contradictions, and curiosity targets, then generates hypothetical scenarios. These scenarios are not stored as ground-truth experience. They are marked as synthetic so later systems can distinguish imagination from observation.

Synthetic replay lets the architecture test possibilities without acting in the environment.

## Adversarial imagination

The system can construct adversarial scenarios that pressure-test plans and beliefs. These scenarios ask how a strategy fails, where a policy is brittle, or which assumption is least supported.

This improves critique by giving the system a richer set of failure cases than observed history alone may contain.

## Abstraction recombination

Dreaming can combine concepts that did not co-occur in experience. Some combinations will be useless. Others may reveal general principles, new hypotheses, or edge cases.

This process supports recursive abstraction by testing whether concepts remain stable when recombined.

## Stress-testing memory

Synthetic scenarios can be compared against consolidated memories and causal models. If the system cannot explain why a synthetic outcome is plausible or impossible, that gap becomes a target for curiosity or grounding.

Dreaming therefore feeds future learning rather than replacing it.

## Artifacts (Tier A)

**Stage covered:** 26, Dreaming System.

**Packages shipped:** `packages/dream-engine/`.

**Runtime role:** The engine performs offline synthetic replay, adversarial imagination, abstraction recombination, and hypothetical experience generation.

**Tier B:** Runtime evidence requires consolidated memories, curiosity targets, and a synthetic-event marking convention.

**Quantitative claims:** Claims about improved robustness or abstraction quality remain pending evaluation.

*Source code: `packages/dream-engine/`. Architecture documentation: `docs/architecture/consolidation-worker.md`. Companion paper chapter: `docs/paper/20-dreaming.md`.*
