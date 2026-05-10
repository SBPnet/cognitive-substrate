# Stage 21: Social Cognition

*This article accompanies Stage 21 of the cognitive-substrate project. It describes the social engine that models users, peers, trust, intent, and cooperative cognition.*

## Cognition with other minds

An agent operating around people or other agents must represent more than tasks and tools. It must model beliefs, intentions, reliability, trust, and cooperative context.

Stage 21 introduces social cognition as an explicit subsystem.

## Persistent user models

The social engine maintains persistent models of interaction partners. These models can include preferences, prior requests, communication style, trust signals, and known constraints.

The purpose is not surveillance. The purpose is continuity and context preservation under the repository's privacy and depersonalization constraints.

## Belief and intent tracking

The engine tracks inferred beliefs and likely intents. This helps distinguish literal instruction, implied goal, uncertainty, and conflict between stated and observed preferences.

Intent inference remains probabilistic. The system should represent uncertainty rather than treating inferred intent as fact.

## Trust scoring

Trust scores estimate reliability of information, instructions, and collaboration patterns. Trust can vary by domain and context.

This allows the agent to weight advice, warnings, or peer proposals differently without hard-coding universal authority.

## Cooperative cognition

The engine also supports multi-agent peers. Cooperative cognition requires modelling what other agents know, what they can do, and where their outputs need verification.

This extends the multi-agent society beyond internal roles toward interaction with external cognitive systems.

## Artifacts (Tier A)

**Stage covered:** 21, Social Cognition.

**Packages shipped:** `packages/social-engine/`.

**Runtime role:** The engine provides persistent user models, belief tracking, intent inference, trust scoring, deception detection, and cooperative cognition support.

**Tier B:** Runtime evidence requires longitudinal interaction records and evaluation tasks involving social context.

**Quantitative claims:** Claims about intent accuracy or trust calibration remain pending evaluation.

*Source code: `packages/social-engine/`. Architecture documentation: `docs/architecture/agent-runtime.md`. Companion paper chapter: `docs/paper/15-social-intelligence.md`.*
