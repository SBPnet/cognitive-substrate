# @cognitive-substrate/kafka-bus

Typed Kafka producers, consumers, topic registry, and W3C trace-context propagation for the cognitive signal bus.

## What it does

All inter-service event traffic in the cognitive substrate flows through Kafka. This package is the single source of truth for:

- **Topic registry** — `src/topics.ts` defines every topic name, key schema, and value schema. Producers and consumers both import from here, eliminating string drift.
- **Typed client** — `KafkaClient` wraps KafkaJS with the monorepo's auth and retry defaults.
- **Typed producers/consumers** — generic `KafkaProducer<T>` and `KafkaConsumer<T>` enforce that message payloads match the declared schema for a given topic.
- **Trace propagation** — `injectTraceContext` / `extractTraceContext` attach and read W3C `traceparent` headers so spans cross service boundaries correctly.

## API

```ts
import { KafkaClient, KafkaProducer, TOPICS } from '@cognitive-substrate/kafka-bus';

const client = new KafkaClient({ brokers: [process.env.KAFKA_BROKER] });
const producer = new KafkaProducer(client, TOPICS.COGNITIVE_EVENTS);
await producer.send(event);
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `TOPICS` | Registry of all topic descriptors |
| `KafkaClient` | Authenticated KafkaJS wrapper |
| `KafkaProducer<T>` | Type-safe producer for a given topic |
| `KafkaConsumer<T>` | Type-safe consumer for a given topic |
| `injectTraceContext` | Writes W3C traceparent into message headers |
| `extractTraceContext` | Reads W3C traceparent from message headers |

## Dependencies

- `kafkajs` — Kafka client library

## Configuration

| Env var | Description |
| ------- | ----------- |
| `KAFKA_BROKER` | Kafka bootstrap server address |
| `KAFKA_SSL_CA` | CA certificate for TLS (Aiven) |
| `KAFKA_SSL_CERT` | Client certificate for mTLS |
| `KAFKA_SSL_KEY` | Client key for mTLS |
