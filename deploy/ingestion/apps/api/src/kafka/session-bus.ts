/**
 * In-process session event bus.
 * The shared Kafka consumer routes incoming InteractionResponseEvents to
 * waiting SSE connections by sessionId using this simple pub/sub map.
 */

import type { InteractionResponseEvent } from "@cognitive-substrate/core-types";

type SessionHandler = (event: InteractionResponseEvent) => void;

export class SessionEventBus {
  private readonly handlers = new Map<string, Set<SessionHandler>>();

  subscribe(sessionId: string, handler: SessionHandler): () => void {
    if (!this.handlers.has(sessionId)) {
      this.handlers.set(sessionId, new Set());
    }
    this.handlers.get(sessionId)!.add(handler);

    return () => {
      const set = this.handlers.get(sessionId);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(sessionId);
      }
    };
  }

  emit(sessionId: string, event: InteractionResponseEvent): void {
    const set = this.handlers.get(sessionId);
    if (!set) return;
    for (const handler of set) {
      handler(event);
    }
  }

  subscriberCount(sessionId: string): number {
    return this.handlers.get(sessionId)?.size ?? 0;
  }
}

export const sessionEventBus = new SessionEventBus();
