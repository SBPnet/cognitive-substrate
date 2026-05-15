# @cognitive-substrate/telemetry-otel

OpenTelemetry SDK bootstrap and cognitive-semantic conventions (`cog.*`) for distributed tracing and observability across the cognitive substrate.

## What it does

Every service in the monorepo calls `initTelemetry()` at startup to configure the OTel SDK. This package provides:

- **SDK bootstrap** — sets up a `TracerProvider` with an OTLP HTTP exporter, batch span processor, and resource attributes derived from environment variables.
- **`cog.*` semantic conventions** — a typed namespace of attribute keys (e.g. `cog.session_id`, `cog.loop_iteration`, `cog.memory_id`) that all packages use instead of raw strings, keeping spans queryable across services.
- **Health-check server** — a lightweight HTTP server that returns `200 OK` once the SDK is initialised, used by container health probes.

## API

```ts
import { initTelemetry, COG } from '@cognitive-substrate/telemetry-otel';

await initTelemetry({ serviceName: 'retrieval-worker' });

const span = tracer.startSpan('retrieve');
span.setAttribute(COG.SESSION_ID, sessionId);
span.setAttribute(COG.LOOP_ITERATION, iteration);
span.end();
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `initTelemetry(options)` | Bootstrap the OTel SDK; call once at process start |
| `COG` | Typed `cog.*` attribute key constants |
| `tracer` | Pre-configured OTel `Tracer` instance |

## Dependencies

- `@opentelemetry/sdk-node` and related OTel SDK packages

## Configuration

| Env var | Description |
| ------- | ----------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP collector endpoint |
| `OTEL_SERVICE_NAME` | Service name (overrides `initTelemetry` option) |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes as `key=value` pairs |
