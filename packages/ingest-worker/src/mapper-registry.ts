import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import type { IngestMapperPlugin } from "@cognitive-substrate/plugin-loader";

export type RawEvent = { type: string; sessionId: string; [key: string]: unknown };

/**
 * Registry-based dispatcher that replaces the closed TelemetryEvent type-switch
 * with an open map of handlers. Built-in handlers are registered via
 * `registerBuiltinMappers`; plugin handlers are registered via `registerPlugin`.
 *
 * Duplicate `type` registrations throw loudly — two plugins must not claim
 * the same event type. Unknown event types return null so a shared topic
 * (ops logs + blog telemetry) cannot poison the consumer offset.
 */
export class IngestMapperRegistry {
  private readonly handlers = new Map<
    string,
    (ev: unknown) => ExperienceEvent | null
  >();

  register(
    eventType: string,
    handler: (ev: unknown) => ExperienceEvent | null,
  ): void {
    if (this.handlers.has(eventType)) {
      throw new Error(
        `[mapper-registry] Duplicate handler for event type "${eventType}"`,
      );
    }
    this.handlers.set(eventType, handler);
  }

  registerPlugin(plugin: IngestMapperPlugin): void {
    for (const eventType of plugin.handles) {
      if (this.handlers.has(eventType)) {
        throw new Error(
          `[mapper-registry] Plugin claims event type "${eventType}" which is already registered`,
        );
      }
      this.handlers.set(eventType, (ev) => plugin.map(ev));
    }
  }

  map(event: RawEvent): ExperienceEvent | null {
    const handler = this.handlers.get(event.type);
    if (handler === undefined) {
      console.warn(
        `[mapper-registry] No handler for event type "${event.type}"; skipping`,
      );
      return null;
    }
    return handler(event);
  }

  hasHandler(eventType: string): boolean {
    return this.handlers.has(eventType);
  }
}
