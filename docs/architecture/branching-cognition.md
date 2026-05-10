---
title: Branching Cognition
category: architecture
status: draft
tags: [branching, sessions, attention, trace, replay]
---

# Branching Cognition

Branching cognition models divergent lines of reasoning, interrupted tasks, and competing contextual continuations as first-class runtime structures. A branch is a traceable reasoning path with its own working context, retrieved memory set, salience state, and policy snapshot.

## Branch Entity

A branch records:

- `branch_id`: stable identifier for the reasoning path
- `parent_branch_id`: optional parent path
- `session_id`: owning cognitive session
- `created_from_event_id`: event that caused the branch
- `policy_version`: policy snapshot at branch creation
- `active_memory_ids`: memory set available to the branch
- `salience_snapshot`: salience distribution at branch creation
- `status`: active, paused, merged, pruned, or quarantined

## Event Model

| Topic | Purpose |
|-------|---------|
| `branch.created` | Creates a branch from an input, interruption, contradiction, or exploration trigger |
| `branch.updated` | Records progress, retrieved memory changes, and salience changes |
| `branch.merged` | Merges useful state into a parent or sibling branch |
| `branch.pruned` | Suppresses a low-utility or unstable branch |

## Observability

Branching cognition requires trace attributes that preserve lineage:

| Attribute | Meaning |
|-----------|---------|
| `cog.branch.id` | current branch identifier |
| `cog.branch.parent_id` | parent branch identifier |
| `cog.branch.status` | active lifecycle state |
| `cog.branch.merge_target` | branch receiving merged state |
| `cog.branch.salience_entropy` | salience dispersion inside the branch |

## Runtime Constraints

Branch count must be budgeted. The scheduler should cap active branches per session, prune low-salience branches, and quarantine branches that repeatedly trigger contradiction, unsafe policy drift, or runaway reinforcement. Branches support adaptive cognition only when their lifecycle remains observable and bounded.
