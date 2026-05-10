# Public Article Reading Order

The article files are numbered by public reading order. Each entry preserves the implementation stage label in its title because each article still accompanies a code release. Public reading order is organized by narrative dependency: readers encounter the conceptual substrate first, then adaptive behavior, multi-agent cognition, self-regulation, world contact, open-ended cognition, and operational intelligence.

This index is the canonical publication sequence for long-form posts. `../architecture/inventory.md` remains the canonical implementation-status sequence.

The series positions Cognitive Substrate as infrastructure beneath agent loops rather than as another agent framework. CoALA-style language-agent architectures are useful comparators for memory, tool use, and decision cycles inside an agent. Cassimatis and Polyscheme are useful comparators for the older cognitive-substrate idea of reusable integrated mechanisms. This series differs by making those mechanisms durable, evented, observable, and shared across agents.

## Part I: Memory Substrate

1. [Stage 1: Experience Ingestion](article-01-experience-ingestion.md)
2. [Stage 2: Memory Retrieval](article-02-memory-retrieval.md)
3. [Stage 3: Consolidation Worker](article-03-consolidation.md)
4. [Stage 35: OpenSearch ML Inference Nodes](article-04-opensearch-ml-inference.md)

Stage 35 appears here as a memory-infrastructure interlude. Its implementation arrived later, but its reader-facing role is to explain how embedding and reranking move closer to the retrieval substrate.

## Part II: Adaptive Behavior

5. [Stage 4: Policy Engine](article-05-policy-engine.md)
6. [Stage 9: Reinforcement Scoring Engine](article-06-reinforcement.md)
7. [Stage 5: Cognitive Agent Loop](article-07-cognitive-loop.md)
8. [Stage 10: Identity Formation](article-08-identity.md)

Stage 4 is introduced before the full reinforcement engine because the policy state must exist before richer learning signals can update it. Stage 9 then expands the reward surface that drives that policy state.

## Part III: Multi-Agent Cognition

9. [Stage 6: Multi-Agent Decomposition](article-09-multi-agent.md)
10. [Stage 7: Internal Debate and Arbitration](article-10-arbitration.md)
11. [Stage 11: World Model](article-11-world-model.md)
12. [Stage 12: Long-Horizon Goals](article-12-goals.md)
13. [Stage 13: Multi-Agent Society](article-13-agent-society.md)

This part moves from role decomposition to arbitration, prediction, goal formation, and finally the integrated runtime.

## Part IV: Self-Regulation

14. [Stage 8: Self-Reflection Loop](article-14-reflection.md)
15. [Stage 14: Attention Engine](article-15-attention.md)
16. [Stage 15: Temporal Cognition](article-16-temporal.md)
17. [Stage 16: Cognitive Economics](article-17-economics.md)
18. [Stage 17: Forgetting System](article-18-forgetting.md)
19. [Stage 18: Affect Modulation](article-19-affect.md)
20. [Stage 19: Narrative Selfhood](article-20-narrative.md)
21. [Stage 20: Meta-Cognition](article-21-metacognition.md)
22. [Stage 23: Constitutional Stability](article-22-constitution.md)

Stage 8 is an early trace-reflection mechanism. Stage 20 returns to the same theme after attention, time, budget, forgetting, affect, and narrative provide a richer supervisory surface.

## Part V: World Contact And Open-Ended Cognition

23. [Stage 21: Social Cognition](article-23-social.md)
24. [Stage 22: Grounded Cognition](article-24-grounding.md)
25. [Stage 24: Causal Intelligence](article-25-causality.md)
26. [Stage 25: Curiosity Engine](article-26-curiosity.md)
27. [Stage 26: Dreaming System](article-27-dreaming.md)
28. [Stage 27: Recursive Abstraction](article-28-abstraction.md)
29. [Stage 28: Developmental Cognition](article-29-development.md)
30. [Stage 29: Open-Ended Intelligence](article-30-open-ended.md)

This part shifts from internal coherence to interaction, environmental feedback, causal intervention, exploration, synthetic replay, abstraction, maturation, and open-ended capability search.

## Part VI: Operational Intelligence

31. [Stage 30: Operational Primitives](article-31-operational-intelligence.md)
32. [Stage 31: ClickHouse Telemetry Layer](article-32-clickhouse-telemetry.md)
33. [Stage 32: Telemetry Ingestion Worker](article-33-telemetry-ingestion.md)
34. [Stage 33: Pattern Detection Worker](article-34-pattern-detection.md)
35. [Stage 34: Reinforcement Feedback Worker](article-35-reinforcement-feedback.md)
36. [Stage 36: Intelligence Transfer](article-36-intelligence-transfer.md)
37. [Stage 37: Real Telemetry as Operational Memory](article-37-real-telemetry-memory.md)

The operational arc applies the same cognitive architecture to infrastructure telemetry. It begins with a transferable vocabulary, then adds temporal storage, ingestion, pattern detection, feedback, transfer across environments, and a hosted experiment showing live telemetry becoming retrievable operational memory.
