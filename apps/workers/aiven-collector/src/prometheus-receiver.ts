/**
 * Prometheus remote_write receiver.
 *
 * Aiven pushes service metrics to POST /metrics/write using the Prometheus
 * remote_write protocol: snappy-compressed protobuf encoding of WriteRequest.
 * This module decodes each request and publishes RawMetricMessage records to
 * the TELEMETRY_METRICS_RAW Kafka topic.
 *
 * Wire format reference:
 *   https://prometheus.io/docs/concepts/remote_write_spec/
 *
 * Proto schema (WriteRequest):
 *   message WriteRequest  { repeated TimeSeries timeseries = 1; }
 *   message TimeSeries    { repeated Label labels = 1; repeated Sample samples = 2; }
 *   message Label         { string name = 1; string value = 2; }
 *   message Sample        { double value = 1; int64 timestamp = 2; }
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decompress } from "snappyjs";
import { Topics, type CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import type { AivenCollectorMetrics } from "@cognitive-substrate/telemetry-otel";
import type { RawMetricMessage } from "./messages.js";

export interface PrometheusReceiverConfig {
  readonly port: number;
  readonly environment: string;
  readonly serviceLabel: string;
  readonly serviceTypeLabel: string;
}

export function startPrometheusReceiver(
  config: PrometheusReceiverConfig,
  producer: CognitiveProducer,
  log: (message: string) => void,
  workerMetrics?: AivenCollectorMetrics,
): () => void {
  const server = createServer((req, res) => {
    void handleRequest(req, res, config, producer, log, workerMetrics);
  });

  server.listen(config.port, () => {
    log(`Prometheus remote_write receiver listening on port ${config.port}`);
  });

  return () => server.close();
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: PrometheusReceiverConfig,
  producer: CognitiveProducer,
  log: (message: string) => void,
  workerMetrics?: AivenCollectorMetrics,
): Promise<void> {
  if (req.method !== "POST" || req.url !== "/metrics/write") {
    res.writeHead(404).end();
    return;
  }

  const body = await readBody(req);

  let uncompressed: Uint8Array;
  try {
    uncompressed = decompress(body);
  } catch {
    res.writeHead(400).end("snappy decompression failed");
    return;
  }

  let writeRequest: WriteRequest;
  try {
    writeRequest = decodeWriteRequest(uncompressed);
  } catch (err) {
    res.writeHead(400).end(`protobuf decode failed: ${String(err)}`);
    return;
  }

  workerMetrics?.prometheusWriteRequests.add(1);
  const observedAt = new Date().toISOString();
  let published = 0;

  for (const ts of writeRequest.timeseries) {
    const labels = Object.fromEntries(ts.labels.map((l) => [l.name, l.value]));
    const metricName = labels["__name__"] ?? "unknown";
    const serviceId = labels[config.serviceLabel] ?? labels["job"] ?? "unknown";
    const serviceType = labels[config.serviceTypeLabel] ?? labels["service_type"] ?? "unknown";

    const kafkaLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (k !== "__name__") kafkaLabels[k] = v;
    }

    for (const sample of ts.samples) {
      const msg: RawMetricMessage = {
        serviceId,
        serviceType,
        metricName,
        value: sample.value,
        labels: kafkaLabels,
        timestamp: new Date(sample.timestampMs).toISOString(),
        environment: config.environment,
      };
      await producer.publish(Topics.TELEMETRY_METRICS_RAW, msg, {
        key: `${serviceId}:${metricName}`,
      });
      published += 1;
    }
  }

  workerMetrics?.prometheusMetricSamples.add(published);
  log(`Published ${published} Prometheus metric samples from remote_write`);
  res.writeHead(204).end();
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Minimal protobuf decoder for Prometheus WriteRequest
//
// We only decode field numbers used by WriteRequest/TimeSeries/Label/Sample.
// Unknown fields are skipped via their wire type, matching the protobuf spec.
// ---------------------------------------------------------------------------

interface WriteRequest {
  readonly timeseries: TimeSeries[];
}

interface TimeSeries {
  readonly labels: ProtoLabel[];
  readonly samples: Sample[];
}

interface ProtoLabel {
  readonly name: string;
  readonly value: string;
}

interface Sample {
  readonly value: number;
  readonly timestampMs: number;
}

function decodeWriteRequest(buf: Uint8Array): WriteRequest {
  const timeseries: TimeSeries[] = [];
  const r = new Reader(buf);
  while (r.pos < buf.length) {
    const tag = r.varint();
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNum === 1 && wireType === 2) {
      timeseries.push(decodeTimeSeries(r.bytes()));
    } else {
      r.skip(wireType);
    }
  }
  return { timeseries };
}

function decodeTimeSeries(buf: Uint8Array): TimeSeries {
  const labels: ProtoLabel[] = [];
  const samples: Sample[] = [];
  const r = new Reader(buf);
  while (r.pos < buf.length) {
    const tag = r.varint();
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNum === 1 && wireType === 2) {
      labels.push(decodeLabel(r.bytes()));
    } else if (fieldNum === 2 && wireType === 2) {
      samples.push(decodeSample(r.bytes()));
    } else {
      r.skip(wireType);
    }
  }
  return { labels, samples };
}

function decodeLabel(buf: Uint8Array): ProtoLabel {
  let name = "";
  let value = "";
  const r = new Reader(buf);
  while (r.pos < buf.length) {
    const tag = r.varint();
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNum === 1 && wireType === 2) {
      name = r.string();
    } else if (fieldNum === 2 && wireType === 2) {
      value = r.string();
    } else {
      r.skip(wireType);
    }
  }
  return { name, value };
}

function decodeSample(buf: Uint8Array): Sample {
  let value = 0;
  let timestampMs = 0;
  const r = new Reader(buf);
  while (r.pos < buf.length) {
    const tag = r.varint();
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    if (fieldNum === 1 && wireType === 1) {
      value = r.double();
    } else if (fieldNum === 2 && wireType === 0) {
      // int64 stored as zigzag varint
      timestampMs = Number(r.varint());
    } else {
      r.skip(wireType);
    }
  }
  return { value, timestampMs };
}

class Reader {
  pos: number = 0;

  constructor(private readonly buf: Uint8Array) {}

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.buf.length) {
      const byte = this.buf[this.pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    return result;
  }

  double(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  string(): string {
    return new TextDecoder().decode(this.bytes());
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: this.bytes(); break;
      case 5: this.pos += 4; break;
      default: throw new Error(`unknown wire type ${wireType}`);
    }
  }
}
