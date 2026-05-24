/**
 * Typed Kafka producer wrapper with automatic W3C trace context injection
 * and mandatory audit-event mirroring.
 */

import { Kafka, Producer, Message, CompressionTypes } from "kafkajs";
import { Topics, type TopicName } from "./topics.js";
import { injectTraceContext, type TraceContext } from "./propagation.js";
import { SchemaRegistryClient, type SchemaRegistryConfig } from "./schema-registry.js";

export interface CognitiveProducerConfig {
  readonly kafka: Kafka;
  readonly enableAuditMirror?: boolean;
  readonly schemaRegistry?: SchemaRegistryConfig;
}

export interface PublishOptions {
  readonly traceContext?: TraceContext;
  readonly key?: string;
  readonly partition?: number;
  /** When set, the payload is Avro-encoded using this schema ID instead of JSON. */
  readonly schemaId?: number;
}

/**
 * Wraps a KafkaJS Producer with type-safe publish methods and automatic
 * W3C traceparent header injection. Every message is optionally mirrored
 * to the audit topic for immutable event history.
 */
export class CognitiveProducer {
  private readonly producer: Producer;
  private readonly enableAuditMirror: boolean;
  private readonly registry: SchemaRegistryClient | undefined;

  constructor(config: CognitiveProducerConfig) {
    this.producer = config.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 5,
    });
    this.enableAuditMirror = config.enableAuditMirror ?? true;
    this.registry = config.schemaRegistry
      ? new SchemaRegistryClient(config.schemaRegistry)
      : undefined;
  }

  /**
   * Register a schema and return its numeric ID. Call once at worker startup
   * to obtain the schemaId to pass in PublishOptions.
   */
  async registerSchema(subject: string, schema: object): Promise<number> {
    if (!this.registry) {
      throw new Error("schemaRegistry not configured on this CognitiveProducer");
    }
    return this.registry.register(subject, schema);
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  /**
   * Publishes a typed payload to the specified topic.
   * Automatically injects W3C trace headers when a TraceContext is provided.
   */
  async publish<T>(
    topic: TopicName,
    payload: T,
    options: PublishOptions = {},
  ): Promise<void> {
    const headers = options.traceContext ? injectTraceContext(options.traceContext) : {};
    const value =
      options.schemaId !== undefined && this.registry
        ? await this.registry.encode(options.schemaId, payload)
        : Buffer.from(JSON.stringify(payload));

    const message: Message = {
      key: options.key ? Buffer.from(options.key) : null,
      value,
      headers,
    };

    const messages: Array<{ topic: string; messages: Message[] }> = [
      { topic, messages: [message] },
    ];

    if (this.enableAuditMirror && topic !== Topics.AUDIT_EVENTS) {
      const auditPayload = { originalTopic: topic, payload, timestamp: new Date().toISOString() };
      messages.push({
        topic: Topics.AUDIT_EVENTS,
        messages: [
          {
            key: options.key ? Buffer.from(options.key) : null,
            value: Buffer.from(JSON.stringify(auditPayload)),
            headers,
          },
        ],
      });
    }

    await this.producer.sendBatch({
      topicMessages: messages,
      compression: CompressionTypes.GZIP,
    });
  }
}
