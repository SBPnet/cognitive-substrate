# Stage 17: Forgetting System

*This article accompanies Stage 17 of the cognitive-substrate project. It describes the forgetting system that suppresses, compresses, retires, and prunes memory so cognition remains usable over time.*

## Forgetting as control

Memory growth without forgetting produces noise. Every retained trace competes for retrieval, attention, and consolidation. A cognitive system must therefore forget strategically.

Stage 17 introduces a forgetting system that manages suppression, compression, contradiction retirement, and graph pruning.

## Why forgetting arrives after the first memory arc

The memory substrate begins in Stages 1 through 3 with ingestion, retrieval, and consolidation. Those stages make memory possible. Stage 17 returns to the same substrate after the agent has policy drift, identity pressure, attention, time, and budget constraints.

That later placement changes the question. Forgetting is no longer only decay inside consolidation. It becomes executive control over an already active memory system: which traces remain retrievable, which contradictions should retire from active belief, and which repeated details should become abstractions.

## Retrieval suppression

Some memories remain true but become unhelpful. The system can suppress them from ordinary retrieval without deleting the underlying record.

Suppression is useful for stale plans, low-quality memories, or traces that repeatedly distract from better evidence.

## Compression hierarchies

Repeated memories can be compressed into summaries, concepts, or patterns. Compression preserves structure while reducing retrieval burden.

This connects forgetting to abstraction. The system does not simply lose detail; it promotes repeated detail into a more general representation.

## Contradiction retirement

When later evidence contradicts earlier memory, the earlier trace may be retired from active use. Retirement preserves auditability while preventing outdated beliefs from steering future action.

This is different from deletion. The system can still reconstruct the history of belief change.

## Graph pruning

Memory relations form graphs. Over time, weak or misleading edges can degrade retrieval quality. The forgetting system prunes low-value edges and reduces graph clutter.

Pruning supports executive control by making relevant memory easier to access.

## Artifacts (Tier A)

**Stage covered:** 17, Forgetting System.

**Packages shipped:** `packages/decay-engine/`.

**Runtime role:** The engine manages retrieval suppression, memory compression, contradiction retirement, graph pruning, and strategic forgetting.

**Tier B:** Runtime evidence requires memory age, retrieval feedback, contradiction records, and consolidation outputs.

**Quantitative claims:** Claims about retrieval quality improvements remain pending evaluation.

*Source code: `packages/decay-engine/`. Architecture documentation: `docs/architecture/consolidation-worker.md`. Companion paper chapter: `docs/paper/11-forgetting.md`.*
