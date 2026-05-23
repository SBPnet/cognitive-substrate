# Scaling guide

This document covers which containers scale horizontally (more replicas) vs vertically (more CPU/RAM), and what gates each approach.

## Horizontal scale: Kafka consumer workers

All five workers are Kafka consumer-group members backed by KEDA `ScaledObject`s. They are stateless between messages; add replicas freely up to the topic partition count.

| Container | Kafka topic consumed | KEDA lag threshold | Max replicas |
|---|---|---|---|
| `ingestion-worker` | `experience.raw` | 500 msgs | 5 |
| `consolidation-worker` | `consolidation.request` | 500 msgs | 5 |
| `telemetry-worker` | `telemetry.metrics.raw` | 500 msgs | 5 |
| `pattern-worker` | `cognition.primitives` | 500 msgs | 5 |
| `reinforcement-worker` | `cognition.recommendations` | 500 msgs | 5 |

**Hard ceiling: topic partition count.** Kafka assigns at most one replica per partition. If a topic has 3 partitions, the 4th replica sits idle. Increase `maxReplicaCount` and topic partition count together.

**Tuning the lag threshold.** The default of 500 is conservative. For burst-heavy workloads (incident ingestion storms matching the Exp 15/17 operational corpus), lower to ~100 for `ingestion-worker` and `telemetry-worker` so KEDA scales out faster.

### api and web

Both are stateless HTTP servers with no affinity constraints and can be scaled freely:

```yaml
# HPA example (api)
minReplicas: 2
maxReplicas: 10
targetCPUUtilizationPercentage: 60
```

No KEDA ScaledObject exists for these yet; add an HPA or KEDA CPU trigger when traffic warrants it.

---

## Vertical scale: stateful / singleton containers

These containers must stay at `replicas: 1`. Horizontal scaling requires architectural changes noted below.

### orchestrator

Runs the full `CognitiveLoop` + `MultiAgentRuntime`. Holds working memory and per-session agent context in process. Multiple replicas would split session state across pods with no coordination layer.

**Scale vertically:** increase `cpu` and `memory` limits in [orchestrator-deployment.yaml](orchestrator-deployment.yaml) as session corpus and agent count grow.

**Path to horizontal scale:** externalize `WorkingMemory` and session state to a shared store (Redis or OpenSearch). Once session state is external, the orchestrator becomes stateless and can run multiple replicas behind a consistent-hash load balancer keyed on session ID.

### provider collector workers

If you run an integration collector (e.g. the Aiven collector from `cognitive-substrate-aiven`) it polls a provider API on timers and holds two in-memory dedup structures:

- `logOffsets: Map<serviceId, offset>`: tracks the last fetched log cursor per service.
- `seenProjectEvents: Set<eventId>`: deduplicates project events within a process lifetime.

Multiple replicas would produce duplicate messages on `telemetry.metrics.raw`, `telemetry.logs.raw`, `telemetry.metadata.raw`, and `telemetry.events.normalized` with no way to coordinate offsets across pods.

**Scale vertically:** collector workers are CPU-light. If the provider API rate-limits at high service counts, shard by service across separate collector deployments each watching a disjoint service list.

**Path to horizontal scale:** move `logOffsets` to a Redis hash and `seenProjectEvents` to a Redis set with TTL. Once state is external, two replicas can share a service list with a partition key on service name.

---

## Infrastructure-tier scaling

The substrate depends on three infrastructure services. These are provider-agnostic and can be run self-hosted (Docker Compose / Kubernetes) or on a managed platform.

| Service | Scale axis | Notes |
|---|---|---|
| **OpenSearch** | Node count + shard count | Add data nodes for index throughput; increase shard count before adding nodes (shard count is fixed at index creation). HNSW graph survives forcemerge (confirmed Exp 31). |
| **Kafka** | Partition count + broker count | Scale partitions first; they directly gate worker horizontal scale. Broker count follows when partition count exceeds broker capacity. |
| **ClickHouse** | Shard count | Pattern and reinforcement workers write here; scale when query latency climbs. |

See the [docker-compose files](../deploy/) for self-hosted setup. For Aiven-managed deployments see the `cognitive-substrate-aiven` repository.

---

## Current resource baselines

| Container | CPU request | CPU limit | Memory request | Memory limit |
| --- | --- | --- | --- | --- |
| api | 100m | 500m | 256Mi | 512Mi |
| web | 100m | 500m | 256Mi | 512Mi |
| orchestrator | 250m | 1000m | 512Mi | 1Gi |
| ingestion-worker | 250m | 1000m | 512Mi | 1Gi |
| consolidation-worker | 250m | 1000m | 512Mi | 1Gi |
| telemetry-worker | 250m | 1000m | 512Mi | 1Gi |
| pattern-worker | 250m | 1000m | 512Mi | 1Gi |
| reinforcement-worker | 250m | 1000m | 512Mi | 1Gi |
