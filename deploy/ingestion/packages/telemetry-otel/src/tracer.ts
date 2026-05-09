/**
 * Convenience tracer factory and span helpers for cognitive-substrate services.
 * Wraps the OTel API to reduce boilerplate in worker implementations.
 */

import { trace, type Tracer, type Span, SpanStatusCode } from "@opentelemetry/api";
import { CogAttributes } from "./conventions.js";

/**
 * Returns a named tracer scoped to the given instrumentation library.
 * Conventionally the library name matches the package name.
 */
export function getTracer(name: string, version = "0.1.0"): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Executes the callback within an active span, automatically recording
 * errors and setting the span status on completion.
 */
export async function withSpan<T>(
  tracer: Tracer,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(spanName, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Type alias for a span attribute map using cog.* conventions. */
export type CogSpanAttributes = Partial<Record<(typeof CogAttributes)[keyof typeof CogAttributes], string | number | boolean>>;
