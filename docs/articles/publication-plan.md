# Article Publication Plan

This plan converts the implementation-stage articles into public long-form posts while preserving each article's code-release mapping.

## Editorial Goals

The public series should read as a coherent argument rather than a sequence of release notes. Each post should introduce one cognitive capability, explain the problem it solves, connect it to the prior post, show the implementation boundary, and close with the next conceptual dependency.

The implementation stage number remains visible because each article accompanies a release. The public sequence follows `docs/articles/index.md`.

Comparative positioning should stay consistent across the series. CoALA-style language-agent architectures are the reference point for agent-internal memory, tool use, and decision cycles. Cassimatis and Polyscheme are the reference point for integrated cognitive-substrate mechanisms. Cognitive Substrate should be framed as a distributed, event-sourced infrastructure substrate beneath agents rather than as a replacement for either lineage.

## Standard Post Shape

Each post should use the following structure unless the subject requires a narrower form:

1. Opening problem: a concrete failure mode or architectural limitation.
2. Thesis: the cognitive capability introduced by the stage.
3. Running example: one scenario carried through the post.
4. Architecture walkthrough: the storage, topic, package, or runtime boundary introduced by the stage.
5. Design boundary: what the stage deliberately does not solve.
6. Evidence status: artifacts, test status, and any pending empirical claims.
7. Forward transition: why the next post follows.

This shape should make the posts suitable for public blog publication, LinkedIn long-form publication, or a serialized project site.

## Rewrite Priorities

Stage 1 and Stage 30 already provide the strongest models. They open with concrete problems and develop a public-facing thesis before listing artifacts.

Stages 2 through 29 need expansion. Most are structurally correct but too compressed. Each should gain a stronger hook, a running example, more explicit transitions, and a short design-boundary section before artifacts.

Stages 31 through 36 are closer to the target style. They mainly need reduced overlap with Stage 30 and clearer separation between storage, ingestion, pattern detection, feedback, local inference, and transfer.

Stage 37 should be treated as an operational-memory epilogue rather than another conceptual stage. Its role is evidence framing: live telemetry became an experience, entered the memory substrate, and later influenced a normal workbench response.

## Ordering Repairs

The following repairs have been applied:

1. `docs/articles/index.md` defines the public reading order.
2. `docs/architecture/inventory.md` identifies implementation status and points to the article index for publication order.
3. `article-05-policy-engine.md` explains why bounded policy state precedes the richer reinforcement engine.
4. `article-14-reflection.md` distinguishes early trace reflection from full meta-cognition.
5. `article-06-reinforcement.md` reconnects reinforcement to the earlier policy engine.
6. `article-18-forgetting.md` explains why forgetting returns after the first memory arc.
7. `article-31-operational-intelligence.md` now frames itself as the operational arc opener.
8. `article-04-opensearch-ml-inference.md` identifies itself as a memory-infrastructure interlude.

## Paper Alignment

The paper now uses the same distinction between conceptual order and implementation order:

1. `docs/paper/index.md` explains synthesis chapters, infrastructure interludes, and the Chapter 7 to Chapter 17 distinction.
2. `docs/paper/06-self-modification.md` frames self-modification as an early conceptual recursion chapter whose enforcement machinery is expanded later.
3. `docs/paper/07-stability-emergence.md` is framed as the close of the foundational arc, not the end of the entire architecture.
4. `docs/paper/17-constitutional-stability.md` is framed as the enforcement architecture for the stability problem introduced earlier.
5. `docs/paper/29-local-inference-memory.md` is framed as a memory-infrastructure interlude inside the operational arc.
