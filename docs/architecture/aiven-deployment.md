---
title: Aiven Deployment Architecture
category: architecture
status: draft
---

# Aiven Deployment Architecture

## Implementation Status

This document describes the deployed-service shape supported by the repository. It is an architecture guide, not proof that every service is currently running. Runtime source remains under `apps/`, `packages/`, `infra/`, and `scripts/`; generated deployment mirrors are not source of truth.

## Purpose

The Aiven deployment packages Cognitive Substrate as managed infrastructure plus application workers. Aiven Kafka carries cognitive and telemetry events, Aiven OpenSearch stores memory and retrieval indexes, PostgreSQL can hold durable policy or application state, ClickHouse stores analytical telemetry, and application services run the API, web workbench, orchestrator, and workers.

## Runtime Surface

Primary runtime paths are:

- `apps/api/` for HTTP and SSE routes.
- `apps/web/` for the workbench UI.
- `apps/orchestrator/` for session processing and agent runtime integration.
- `apps/workers/ingestion/`, `apps/workers/consolidation/`, `apps/workers/telemetry/`, `apps/workers/pattern/`, and `apps/workers/reinforcement/` for background processing.
- `infra/aiven/` for managed service definitions.
- `packages/kafka-bus/src/topics.ts` for the source-of-truth topic registry.

## Service Boundaries

Kafka is the event boundary between applications. OpenSearch is the memory and search boundary. ClickHouse is the analytical telemetry boundary. Object storage is available through `packages/memory-objectstore/`, but some smoke and hosted experiments intentionally use a no-op provider when the evidence target is OpenSearch retrieval.

## Configuration

Application services receive credentials and feature flags through environment variables. The repository contains examples and worker configuration code, but production values must come from the hosting environment. Embedding providers, OpenSearch credentials, Kafka brokers, ClickHouse settings, and telemetry bridge flags are all runtime configuration rather than hard-coded architecture.

## Evidence

The deployment architecture is supported by package and worker entrypoints, smoke scripts under `scripts/smoke/`, and Terraform under `infra/aiven/`. Treat claims about hosted behavior as valid only when backed by a smoke report, article evidence, or a specific deployment run.
