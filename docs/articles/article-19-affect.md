# Stage 18: Affect Modulation

*This article accompanies Stage 18 of the cognitive-substrate project. It describes the affect engine that modulates attention, risk, curiosity, and contradiction response through synthetic global signals.*

## Affect as runtime modulation

Affect in this architecture is not simulated emotion for presentation. It is a control layer that modulates cognition. The system uses synthetic signals analogous to dopamine, norepinephrine, and serotonin as computational variables that influence attention, reinforcement, and exploration.

These are computational parallels, not biological equivalences.

## Global affect vector

The affect engine maintains a global runtime affect vector. Components of the vector represent reward expectation, arousal or alertness, stability, curiosity pressure, and contradiction stress.

The vector changes how other systems allocate attention and compute. A high-alert state can increase interrupt sensitivity. A high-curiosity state can raise exploration priority. A high-contradiction state can route more work to reflection.

## Dopamine-like reward modulation

The dopamine-like signal tracks reward expectation and prediction error. Positive surprise can increase salience and reinforcement. Negative surprise can trigger review or policy adjustment.

The signal does not replace reinforcement scoring. It modulates how strongly outcomes affect other subsystems.

## Norepinephrine-like alerting

The norepinephrine-like signal represents urgency and uncertainty. It can broaden attention, increase responsiveness to interrupts, and shift tasks from fast mode to slow mode.

This gives the agent a mechanism for reacting differently under unstable conditions.

## Serotonin-like stability

The serotonin-like signal represents longer-term stability and regulation. It can dampen impulsive shifts, preserve focus, and reduce overreaction to transient rewards or failures.

Together, these signals let the architecture express mood-like runtime states without treating mood as an identity claim.

## Artifacts (Tier A)

**Stage covered:** 18, Affect Modulation.

**Packages shipped:** `packages/affect-engine/`.

**Runtime role:** The engine maintains synthetic affect signals and couples them to attention, curiosity, contradiction stress, and reinforcement.

**Tier B:** Runtime evidence requires integration with attention, reinforcement, and identity history.

**Quantitative claims:** Claims about improved exploration or regulation remain pending evaluation.

*Source code: `packages/affect-engine/`. Architecture documentation: `docs/architecture/attention-modes.md` and `docs/architecture/multi-circuit-reward.md`. Companion paper chapter: `docs/paper/12-emotional-modulation.md`.*
