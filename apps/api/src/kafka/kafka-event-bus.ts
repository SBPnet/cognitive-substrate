/**
 * In-process bus for forwarding arbitrary Kafka topic messages to SSE clients.
 * Keyed by sessionId extracted from each message's key field.
 */

import type { KafkaEventDto } from "../types.js";

type KafkaEventHandler = (event: KafkaEventDto) => void;

class KafkaEventBus {
  private readonly handlers = new Map<string, Set<KafkaEventHandler>>();

  subscribe(sessionId: string, handler: KafkaEventHandler): () => void {
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

  emit(sessionId: string, event: KafkaEventDto): void {
    const set = this.handlers.get(sessionId);
    if (!set) return;
    for (const handler of set) handler(event);
  }

  hasSubscribers(sessionId: string): boolean {
    return (this.handlers.get(sessionId)?.size ?? 0) > 0;
  }
}

export const kafkaEventBus = new KafkaEventBus();
