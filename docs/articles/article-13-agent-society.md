# Stage 13: Multi-Agent Society

*This article accompanies Stage 13 of the cognitive-substrate project. It describes the integration of specialized agents into a coordinated runtime that can scale across distributed infrastructure.*

## From roles to society

Stages 6 and 7 introduced specialized agents and arbitration. Stage 13 integrates the full society: planner, executor, critic, memory agent, world-model agent, and meta-cognition agent operating together inside the orchestrator.

The result is not a group chat among agents. It is a structured runtime in which each role contributes a bounded function to a shared cognitive loop.

## Coordinated execution

The orchestrator assigns work to agents, gathers outputs, applies arbitration, records activity traces, and emits outcome events. Each agent remains replaceable because communication flows through typed interfaces rather than shared hidden state.

This design supports both local execution and distributed deployment.

## Scaling by partition

Kafka partitioning provides the horizontal scaling boundary. Sessions, tasks, or event streams can be partitioned so multiple worker instances process independent cognitive flows.

Partitioning preserves order where order matters while allowing throughput to grow with additional workers.

## Deployment surface

The stage introduces Kubernetes manifests and Aiven-backed deployment expectations for the complete runtime. Kafka carries events, OpenSearch stores semantic and trace indexes, PostgreSQL stores configuration and policy state, and object storage preserves raw experience payloads.

This is the first stage where the architecture becomes a deployable distributed cognitive system rather than a set of packages.

## Operational observability

The agent society emits traces for each cognitive role. These traces are essential because multi-agent systems can fail in distributed ways: memory may retrieve weak context, the planner may generate a poor strategy, the critic may miss a risk, or arbitration may overweight reward.

Observability turns those failures into inspectable evidence.

## Artifacts (Tier A)

**Stage covered:** 13, Multi-Agent Society.

**Packages shipped:** Full orchestrator integration in `apps/orchestrator/` and deployment manifests in `infra/k8s/`.

**Runtime:** Planner, executor, critic, memory agent, world-model agent, and meta-cognition agent operate as a coordinated runtime.

**Tier B:** End-to-end evidence requires Kafka, OpenSearch, PostgreSQL, object storage, and worker deployment.

**Quantitative claims:** Claims about scalability and multi-agent performance remain pending load testing and task evaluation.

*Source code: `apps/orchestrator/` and `infra/k8s/`. Architecture documentation: `docs/architecture/agent-runtime.md` and `docs/architecture/aiven-deployment.md`. Companion paper chapter: `docs/paper/04-multi-agent.md`.*
