---
title: Primitive Pattern Detection for Operational Diagnosis
chapter: 27
arc: operational-intelligence
status: draft
tags: [pattern-detection, diagnosis, primitives, opensearch, incidents]
---

# Chapter 27. Primitive Pattern Detection for Operational Diagnosis

*Chapter 27. Companion code: Stage 33 (pattern detection worker). See also `docs/articles/article-34-pattern-detection.md` for the engineering narrative.*

## 27.1 Diagnostic Problem

Operational incidents rarely appear as single isolated metrics. They emerge as configurations of signals over time: queue growth, tail latency expansion, retries, resource pressure, replication lag, or structural rebalance. Diagnosis therefore requires pattern recognition over temporal sets of primitives.

The pattern worker implements this recognition process. It consumes operational primitive events and compares the active event set against a library of system-agnostic operational patterns.

## 27.2 Pattern Representation

An operational pattern is represented as:

$$P = (S, A, O, I, c)$$

where $S$ is the full primitive signature, $A$ is the precursor set, $O$ is the outcome description, $I$ is the ordered intervention list, and $c$ is confidence.

The signature defines a mature pattern. The precursor set defines early evidence that the pattern may be developing.

## 27.3 Sliding Window

Let $W_t$ be the set of primitive events observed during the detection window ending at time $t$. A full match occurs when:

$$S_P \subseteq primitives(W_t)$$

where $S_P$ is the signature of pattern $P$.

A precursor match occurs when:

$$A_P \subseteq primitives(W_t) \land S_P \nsubseteq primitives(W_t)$$

Precursor matches are scored lower than full matches. This distinction separates early warning from mature diagnosis.

## 27.4 Candidate Ranking

Candidate matches are ranked by match score. Full matches use the pattern confidence directly. Precursor matches use a reduced confidence. Candidates below threshold are suppressed, and the remaining matches are capped to bound downstream compute.

The result is a ranked diagnostic hypothesis set rather than a single absolute classification.

## 27.5 Pattern Library Store

The serving pattern library resides in the `operational_patterns` OpenSearch index. This choice makes patterns mutable and searchable while preserving the ability to update confidence independently from code deployment.

The built-in seed library gives new deployments initial diagnostic coverage. Learned confidence updates and authored patterns can then extend or revise the library.

## 27.6 Recommendation Semantics

A recommendation emitted from a pattern match is not an automated remediation command. It is a structured diagnostic artifact:

$$R = (id, P, score, O, I, t)$$

where $id$ is recommendation identifier, $P$ is pattern identifier, $score$ is match score, $O$ is outcome description, $I$ is intervention list, and $t$ is timestamp.

This artifact becomes the input to reinforcement feedback in Chapter 28.

## 27.7 Limitations

The detector only recognizes patterns represented in the library. It is not an unsupervised anomaly detector and does not discover arbitrary new failure modes. Novel incident classes require pattern authoring or a later discovery mechanism.

Detection accuracy, early-warning precision, and false-positive rates require empirical replay against labelled incidents.

---

*Companion article: `docs/articles/article-34-pattern-detection.md`. Architecture documentation: `docs/architecture/operational-primitives.md`. Source code: `apps/workers/pattern/` and `packages/abstraction-engine/src/primitives/pattern-library.ts`.*
