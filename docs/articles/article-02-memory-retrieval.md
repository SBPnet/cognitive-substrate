# Stage 2: Memory Retrieval

*This article accompanies Stage 2 of the cognitive-substrate project. It describes the retrieval layer that turns indexed experience into active cognitive context through hybrid search, policy weighting, and feedback capture.*

## The problem with stored memory

An indexed experience is not yet useful memory. Storage preserves events, but cognition requires selection. At any moment, the agent must decide which past experiences deserve scarce reasoning context.

Stage 2 introduces the retrieval engine. It queries OpenSearch across `experience_events` and `memory_semantic`, combining lexical recall, vector similarity, recency, importance, and policy alignment into a ranked context set.

This article follows [Stage 1: Experience Ingestion](article-01-experience-ingestion.md), where experiences first become durable archive entries and searchable index documents. It leads into [Stage 3: Consolidation Worker](article-03-consolidation.md), where repeated retrieval evidence begins to reshape semantic memory.

## Hybrid recall

The retrieval path uses both BM25 and k-NN search. BM25 captures exact terms, identifiers, and explicit topic overlap. Vector search captures semantic similarity when the same problem appears under different wording.

Neither signal is sufficient alone. Pure keyword retrieval misses paraphrase and analogy. Pure vector retrieval can blur precise operational constraints. Hybrid search gives the architecture a memory surface that is both literal and associative.

## Policy-weighted ranking

Retrieval is not neutral. The current policy state affects what the system considers relevant. A `script_score` query incorporates policy alignment, importance score, decay factor, and retrieval count into the final rank.

This creates a feedback-sensitive memory system. Memories that are important, recent, policy-aligned, and semantically relevant are elevated. Memories that have decayed or repeatedly failed to help are suppressed.

## Context filters

The engine supports filters for time range, tags, and importance threshold. These filters protect reasoning budget by narrowing retrieval to the cognitive frame of the current task.

Filtering also makes retrieval auditable. When a memory is excluded, the reason can be expressed as a time, tag, or threshold constraint rather than hidden model behaviour.

## Feedback capture

Every retrieval can produce feedback. The retrieval engine writes usage and quality signals to the `retrieval_feedback` index and audit stream. Later stages use this evidence to adjust importance, reinforcement score, and policy alignment.

This turns retrieval from a stateless lookup into a learning surface. The system begins to remember not only what happened, but which memories were useful when similar situations recurred.

## Artifacts (Tier A)

**Stage covered:** 2, Memory Retrieval.

**Packages shipped:** `packages/memory-opensearch/` extends query construction and `packages/retrieval-engine/` provides retrieval orchestration, mapping, and feedback capture.

**Storage:** Retrieval reads `experience_events` and `memory_semantic`, and writes `retrieval_feedback` and audit events.

**Tier B:** End-to-end evidence requires an indexed experience corpus and OpenSearch with vector search enabled.

**Quantitative claims:** Retrieval quality and ranking improvements remain pending benchmark and ablation evidence.

*Source code: `packages/memory-opensearch/` and `packages/retrieval-engine/`. Architecture status: `docs/architecture/inventory.md`. Companion paper chapter: `docs/paper/02-memory-substrate.md`.*
