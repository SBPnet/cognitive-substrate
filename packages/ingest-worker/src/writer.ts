/**
 * OpenSearch writer for the ingest worker.
 *
 * Manages a small in-memory buffer and flushes it as a bulk request when
 * either the buffer fills or the flush interval fires. The experience_events
 * index must already exist (created by provision-indexes or ensureIndexes).
 * If a neural ingest pipeline is configured, the index's default_pipeline
 * handles embedding generation automatically.
 *
 * Buffer defaults: 50 documents or 5 seconds, whichever comes first.
 */

import type { Client } from "@opensearch-project/opensearch";
import type { ExperienceEvent } from "@cognitive-substrate/core-types";

const INDEX = "experience_events";

interface WriterOptions {
  readonly client: Client;
  /** How many events to accumulate before flushing. Default: 50. */
  readonly bufferSize?: number;
  /** Maximum ms between flushes even if buffer is not full. Default: 5000. */
  readonly flushIntervalMs?: number;
}

export class ExperienceWriter {
  private readonly client: Client;
  private readonly bufferSize: number;
  private readonly flushIntervalMs: number;
  private buffer: ExperienceEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(opts: WriterOptions) {
    this.client = opts.client;
    this.bufferSize = opts.bufferSize ?? 50;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
  }

  async write(event: ExperienceEvent): Promise<void> {
    this.buffer.push(event);
    this.scheduleFlush();
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((err) => {
        console.error("[writer] Flush error:", (err as Error).message);
      });
    }, this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    const batch = this.buffer.splice(0, this.buffer.length);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    try {
      const body: Record<string, unknown>[] = [];
      for (const event of batch) {
        body.push({ index: { _index: INDEX, _id: event.eventId } });
        body.push({
          event_id:         event.eventId,
          timestamp:        event.timestamp,
          event_type:       event.type,
          session_id:       event.context.sessionId,
          ...(event.context.userId !== undefined ? { user_id: event.context.userId } : {}),
          agent_id:         event.context.agentId ?? "ingest-worker",
          summary:          event.input.text,
          importance_score: event.importanceScore,
          reward_score:     event.importanceScore * 0.8,
          retrieval_count:  0,
          tags:             [...event.tags],
        });
      }

      await this.client.bulk({ body });
      console.log(`[writer] Indexed ${batch.length} events`);
    } catch (err) {
      console.error("[writer] Bulk index failed:", (err as Error).message);
      // Re-queue failed batch at the front so we don't lose events across transient failures.
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
