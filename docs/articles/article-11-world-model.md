# Stage 11: World Model

*This article accompanies Stage 11 of the cognitive-substrate project. It describes the world-model component that simulates likely outcomes before action selection.*

## Prediction before commitment

An agent that acts only from retrieved memory and current policy remains reactive. It can remember what happened before, but it cannot explicitly test what may happen next. Stage 11 introduces a world model: a predictive component that simulates outcomes for proposed actions.

The world model receives current state and a candidate action, then returns predicted outcome, risk score, and confidence estimate.

## Outcome simulation

The simulation is LLM-driven in this stage. It uses context from memory, goals, and policy to infer likely consequences. The result is stored as a prediction record in `world_model_predictions`.

Prediction records make the model accountable. Later outcomes can be compared against prior predictions, creating evidence for calibration and reinforcement.

## Risk scoring

Risk is not the opposite of reward. A high-reward action can also carry high downside. The world model therefore emits an explicit risk score that can be used by arbitration.

This lets the system reject actions that look useful but produce unacceptable downstream exposure.

## Confidence estimation

The model also estimates confidence. Low-confidence predictions should influence arbitration differently from high-confidence predictions. A cautious system may request more retrieval, more critique, or a lower-risk action when confidence is low.

Confidence becomes useful only when later compared to observed outcomes. Stage 11 therefore prepares data for later calibration.

## Arbitration integration

The world model participates in multi-agent decision-making as a risk and prediction expert. Candidate actions can be penalized when predicted risk is high or when expected outcome is poor.

This integration shifts the agent from action selection by immediate plausibility toward action selection by simulated consequence.

## Artifacts (Tier A)

**Stage covered:** 11, World Model.

**Packages shipped:** `packages/world-model/`.

**Storage:** Prediction records are written to `world_model_predictions`.

**Tier B:** Runtime evidence requires candidate actions, hydrated context, and observed outcomes for comparison.

**Quantitative claims:** Prediction accuracy and calibration claims remain pending evaluation.

*Source code: `packages/world-model/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/05-world-models-goals.md`.*
