---
title: OpenTelemetry Observability Architecture
category: architecture
status: draft
---

# OpenTelemetry Observability Architecture

## Implementation Status

The repository includes an observability helper package in `packages/telemetry-otel/` and telemetry workers under `apps/workers/telemetry/`. Metric names proposed in design documents are not runtime guarantees unless they are emitted by code or captured in smoke evidence.

## Purpose

OpenTelemetry provides the common instrumentation layer for service health, worker activity, cognitive event flow, and operational intelligence. It should make the route from experience ingestion to retrieval, reasoning, policy update, and response observable across service boundaries.

## Runtime Surface

The main code surface is `packages/telemetry-otel/`, including health-server support. Worker and app packages can import this package for common instrumentation, while operational telemetry ingestion is handled separately by `apps/workers/telemetry/` and `packages/clickhouse-telemetry/`.

## Trace Shape

A useful trace should preserve session identifiers, event identifiers, topic names, index names, worker stage, and outcome. Cognitive terms such as salience, attention, policy, and reinforcement should be represented as attributes only when the producing code has computed those values.

## Metrics Shape

Service metrics should stay close to operational facts: request latency, worker batch counts, consumer lag, indexing latency, embedding latency, retrieval result count, and error counts. Higher-level cognitive metrics should be introduced only with code-level emitters and validation.

## Evidence

The current evidence surface is package entrypoint coverage, worker instrumentation code, health endpoints, and smoke reports. This document does not claim complete distributed tracing coverage across all applications.
