# Stage 3: Consolidation Worker

*This article accompanies Stage 3 of the cognitive-substrate project. It describes the offline consolidation loop that replays experiences, compresses them into semantic memory, and updates long-term retrieval value.*

## Why memory needs a sleep cycle

Immediate ingestion captures experience quickly, but fast capture is not deep learning. Raw traces are noisy, redundant, and local to the moment in which they occurred. A cognitive system needs an offline process that revisits experience after the immediate action loop has finished.

Stage 3 introduces that process. The consolidation worker consumes `consolidation.request`, selects experiences for replay, summarizes and clusters them, detects contradictions, adjusts decay, and emits `memory.semantic.updated`.

## Replay selection

The worker selects replay candidates using novelty, reward, and recency. Highly novel experiences may contain new concepts. High-reward experiences may encode successful strategies. Recent experiences remain useful for near-term adaptation.

The selection policy prevents consolidation from becoming a bulk summarization job. It focuses compute on memories most likely to change future behaviour.

## Semantic compression

Selected experiences are passed through summarization and abstraction generation. The output is not a duplicate of the raw event. It is a semantic memory: a compressed representation that names the pattern, extracts reusable structure, and links back to source experience identifiers.

This creates the first transition from episodic memory to semantic memory. Individual events remain available in the truth layer, while the semantic layer becomes the primary substrate for later retrieval and reasoning.

## Clustering and contradiction

The worker clusters related memories so that repeated events can accumulate into stable concepts. It also detects contradictions, because memory growth without contradiction handling creates incoherent belief state.

Contradiction does not automatically delete a memory. It marks tension that later policy, identity, or reflection stages can resolve. The system therefore preserves evidence while making inconsistency visible.

## Decay and reinforcement

Consolidation updates decay factors and reinforcement scores. Some memories become more retrievable because they are predictive, important, or reward-aligned. Others fade because they are redundant, stale, or unsupported by later outcomes.

This mechanism gives memory a lifecycle. Experiences are born at ingestion, revisited during consolidation, and gradually promoted, compressed, or deprioritized.

## Artifacts (Tier A)

**Stage covered:** 3, Consolidation Worker.

**Packages shipped:** `apps/workers/consolidation/` and `packages/consolidation-engine/`.

**Kafka topics:** The worker consumes `consolidation.request` and emits `memory.semantic.updated`.

**Tier B:** End-to-end evidence requires an indexed corpus and an LLM runtime for summarization and abstraction.

**Quantitative claims:** Claims about improved retrieval quality or abstraction stability remain pending evaluation.

*Source code: `apps/workers/consolidation/` and `packages/consolidation-engine/`. Architecture documentation: `docs/architecture/consolidation-worker.md`. Companion paper chapter: `docs/paper/02-memory-substrate.md`.*
