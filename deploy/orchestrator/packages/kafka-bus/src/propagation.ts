/**
 * W3C Trace Context (traceparent / tracestate) propagation helpers for Kafka.
 * These utilities inject and extract trace context into/from Kafka message
 * headers so that distributed traces span across producers and consumers.
 *
 * Specification: https://www.w3.org/TR/trace-context/
 */

import type { IHeaders } from "kafkajs";

const TRACEPARENT_HEADER = "traceparent";
const TRACESTATE_HEADER = "tracestate";

/** Parsed representation of a W3C traceparent header. */
export interface TraceContext {
  readonly version: string;
  readonly traceId: string;
  readonly parentId: string;
  readonly traceFlags: string;
  readonly traceState?: string;
}

/**
 * Encodes a TraceContext into Kafka message headers.
 * The encoded traceparent follows the format: `{version}-{traceId}-{parentId}-{flags}`.
 */
export function injectTraceContext(ctx: TraceContext): IHeaders {
  const traceparent = `${ctx.version}-${ctx.traceId}-${ctx.parentId}-${ctx.traceFlags}`;
  const headers: IHeaders = { [TRACEPARENT_HEADER]: Buffer.from(traceparent) };
  if (ctx.traceState) {
    headers[TRACESTATE_HEADER] = Buffer.from(ctx.traceState);
  }
  return headers;
}

/**
 * Extracts a TraceContext from Kafka message headers.
 * Returns undefined when no valid traceparent header is present.
 */
export function extractTraceContext(headers: IHeaders | undefined): TraceContext | undefined {
  if (!headers) return undefined;

  const raw = headers[TRACEPARENT_HEADER];
  if (!raw) return undefined;

  const traceparent = Buffer.isBuffer(raw) ? raw.toString() : String(raw);
  const parts = traceparent.split("-");
  if (parts.length !== 4) return undefined;

  const [version, traceId, parentId, traceFlags] = parts as [string, string, string, string];

  const traceStateRaw = headers[TRACESTATE_HEADER];
  const traceState = traceStateRaw
    ? Buffer.isBuffer(traceStateRaw)
      ? traceStateRaw.toString()
      : String(traceStateRaw)
    : undefined;

  const result: TraceContext = { version, traceId, parentId, traceFlags };
  if (traceState !== undefined) {
    return { ...result, traceState };
  }
  return result;
}

/**
 * Generates a new 32-character hexadecimal trace ID.
 * In production this should be delegated to the OTel SDK.
 */
export function generateTraceId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/**
 * Generates a new 16-character hexadecimal span/parent ID.
 */
export function generateSpanId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** Constructs a minimal TraceContext for a new root span. */
export function newRootTraceContext(): TraceContext {
  return {
    version: "00",
    traceId: generateTraceId(),
    parentId: generateSpanId(),
    traceFlags: "01",
  };
}
