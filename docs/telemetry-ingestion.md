# Telemetry Ingestion

The cognitive-substrate runs an OpenTelemetry Collector that accepts standard OTLP from any source -- internal services, external applications, CI pipelines, browsers, mobile clients, or third-party tools. Anything that speaks OTLP can send telemetry without any custom integration.

## Endpoints

The collector listens on two standard OTLP ports:

| Protocol | Address | Use when |
| --- | --- | --- |
| gRPC (OTLP/gRPC) | `<collector-host>:4317` | Server-side clients, high-volume, binary framing |
| HTTP (OTLP/HTTP) | `<collector-host>:4318` | Browser clients, firewalls that block gRPC, simpler setup |

Both ports accept traces, metrics, and logs. The collector routes all three signal types into Kafka for downstream processing.

## What the collector does with your data

```
Your service / tool
  ↓ OTLP (gRPC :4317 or HTTP :4318)
OTEL Collector
  ↓ batch + memory_limiter + resource enrichment (deployment.environment)
  ├── traces   → Kafka: telemetry.traces.raw   (incident reconstruction, causality)
  ├── metrics  → Kafka: telemetry.metrics.otlp (ClickHouse, operational cognition)
  └── logs     → Kafka: telemetry.logs.raw     (ingest-worker, experience pipeline)
```

Logs that arrive on `telemetry.logs.raw` are processed by the ingest-worker. If the log's `type` field matches a registered plugin handler, it is mapped to an `ExperienceEvent` and indexed into OpenSearch. Traces and metrics flow into the cognition pipeline for anomaly detection and pattern matching.

## Sending from a service (standard OTEL SDK)

Point any OTEL SDK at the collector by setting two environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector-host>:4318
OTEL_SERVICE_NAME=my-service
```

That is the complete configuration for HTTP. For gRPC, use port 4317 and consult your SDK's gRPC exporter docs (some require `grpc://` as the scheme).

**Node.js:**

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://<collector-host>:4318/v1/traces",
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://<collector-host>:4318/v1/metrics",
    }),
  }),
});

sdk.start();
```

Internal substrate services use `@cognitive-substrate/telemetry-otel` which wraps this setup and adds `cog.*` semantic conventions. External services use whatever OTEL SDK fits their language.

**Python:**

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://<collector-host>:4318/v1/traces"))
)
trace.set_tracer_provider(provider)
```

**Go:**

```go
import (
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

exporter, _ := otlptracehttp.New(ctx,
    otlptracehttp.WithEndpoint("<collector-host>:4318"),
    otlptracehttp.WithInsecure(),
)
tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
```

## Sending from a browser

Use `@opentelemetry/exporter-trace-otlp-http` with CORS configured on the collector. The OTLP/HTTP endpoint supports browser clients natively:

```typescript
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const provider = new WebTracerProvider();
provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({ url: "https://<collector-host>:4318/v1/traces" })
  )
);
provider.register();
```

If the collector sits behind a different origin than the browser app, add the browser's origin to the collector's CORS allowed origins. The current `otel-collector-config.yml` does not configure CORS -- add a `cors` block under the `http` receiver if browser clients need direct access. Alternatively, proxy OTLP through the API to avoid the CORS requirement entirely.

## Sending from a CI pipeline

Use the `otel-cli` tool to emit traces for build and test steps without instrumenting code:

```bash
# Install
brew install equinix-labs/otel-cli/otel-cli
# or: go install github.com/equinix-labs/otel-cli@latest

export OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector-host>:4318
export OTEL_SERVICE_NAME=ci-pipeline

# Wrap a command in a span
otel-cli exec --name "run tests" -- pnpm test

# Emit a span manually
otel-cli span \
  --name "deploy to staging" \
  --attrs "git.branch=$(git rev-parse --abbrev-ref HEAD),git.sha=$(git rev-parse HEAD)"
```

## Sending structured logs that become ExperienceEvents

Logs that arrive via OTLP are routed to `telemetry.logs.raw`. If a log's body parses as JSON with a `type` field matching a registered ingest-mapper plugin, the ingest-worker converts it to an `ExperienceEvent` and indexes it into OpenSearch.

To emit a log that the ingest-worker will pick up, structure it as a JSON body with `type` and `sessionId` fields:

```typescript
import { logs } from "@opentelemetry/api-logs";

const logger = logs.getLogger("my-service");

logger.emit({
  body: JSON.stringify({
    type: "github_push",           // must match an ingest-mapper plugin's handles[]
    sessionId: "session-abc123",
    timestamp: new Date().toISOString(),
    repository: "SBPnet/cognitive-substrate",
    branch: "main",
    commitCount: 3,
    message: "feat: add telemetry ingestion doc",
  }),
  severityText: "INFO",
});
```

The log travels: OTEL SDK -> collector -> `telemetry.logs.raw` -> ingest-worker -> `map()` -> OpenSearch.

Logs that do not match any registered plugin are currently dropped with an error logged to the ingest-worker console. If you are sending logs for observability purposes only (not cognitive pipeline ingestion), use a separate OTEL log exporter that routes to your log storage backend rather than pointing at this collector.

## Collector host by environment

| Environment | Collector address |
| --- | --- |
| Local dev | `http://localhost:4318` (HTTP) / `localhost:4317` (gRPC) |
| Docker Compose | `http://otel-collector:4318` (service name in compose network) |
| Kubernetes | `http://otel-collector.<namespace>.svc.cluster.local:4318` |
| Production | Set via `OTEL_EXPORTER_OTLP_ENDPOINT` in deployment env |

The collector config lives at [deploy/otel-collector-config.yml](../deploy/otel-collector-config.yml). It requires `KAFKA_BROKERS` and `ENVIRONMENT` env vars at startup.

## Resource attributes

The collector injects `deployment.environment` from its own `ENVIRONMENT` env var into every span, metric, and log it processes. You do not need to set this in your client.

Additional resource attributes your service should set:

| Attribute | How to set | Example |
| --- | --- | --- |
| `service.name` | `OTEL_SERVICE_NAME` env var | `my-service` |
| `service.version` | `OTEL_RESOURCE_ATTRIBUTES=service.version=1.2.3` | `1.2.3` |
| `service.instance.id` | `OTEL_RESOURCE_ATTRIBUTES=service.instance.id=pod-xyz` | `pod-xyz` |

Internal substrate services additionally use `cog.*` attributes defined in `@cognitive-substrate/telemetry-otel` (`cog.session_id`, `cog.loop_iteration`, `cog.memory_id`, etc.) for cognitive-specific queryability. External services do not need these.
