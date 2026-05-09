/**
 * Typed Kafka consumer wrapper with W3C trace context extraction
 * and typed message handling.
 */

import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { extractTraceContext, type TraceContext } from "./propagation.js";
import type { TopicName } from "./topics.js";

export interface CognitiveConsumerConfig {
  readonly kafka: Kafka;
  readonly groupId: string;
}

export interface TypedMessage<T> {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
  readonly timestamp: string;
  readonly key: string | null;
  readonly value: T;
  readonly traceContext: TraceContext | undefined;
}

export type MessageHandler<T> = (message: TypedMessage<T>) => Promise<void>;

/**
 * Wraps a KafkaJS Consumer with typed message deserialization and automatic
 * W3C trace context extraction from message headers.
 */
export class CognitiveConsumer {
  private readonly consumer: Consumer;

  constructor(config: CognitiveConsumerConfig) {
    this.consumer = config.kafka.consumer({
      groupId: config.groupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
    });
  }

  async connect(): Promise<void> {
    await this.consumer.connect();
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }

  /**
   * Subscribes to one or more topics and processes messages with a typed handler.
   * Messages are deserialized from JSON before being passed to the handler.
   */
  async subscribe<T>(
    topics: ReadonlyArray<TopicName>,
    handler: MessageHandler<T>,
  ): Promise<void> {
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload): Promise<void> => {
        const { topic, partition, message } = payload;

        if (!message.value) return;

        const value = JSON.parse(message.value.toString()) as T;
        const key = message.key ? message.key.toString() : null;
        const traceContext = extractTraceContext(message.headers ?? undefined);

        await handler({
          topic,
          partition,
          offset: message.offset,
          timestamp: message.timestamp,
          key,
          value,
          traceContext,
        });
      },
    });
  }
}
