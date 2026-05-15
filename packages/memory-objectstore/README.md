# @cognitive-substrate/memory-objectstore

S3-compatible episodic truth-layer client for durable storage and retrieval of raw experience events.

## What it does

OpenSearch holds semantic memories (processed, indexed, searchable). The object store holds the raw episodic record — the append-only log of every `Experience` event as it arrived. This separation means:

- Semantic memories can be re-derived from raw events if indexes are rebuilt.
- Raw events are immutable; only the object store copy is authoritative.
- Large payloads (e.g. sensor snapshots) stay out of OpenSearch.

The client wraps the AWS SDK S3 client with key-building helpers that encode session ID and timestamp into a deterministic path.

## API

```ts
import { ObjectStoreClient, buildEventKey } from '@cognitive-substrate/memory-objectstore';

const client = new ObjectStoreClient({ bucket: process.env.EPISODIC_BUCKET });
await client.put(event);
const event = await client.get(buildEventKey(sessionId, eventId));
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `ObjectStoreClient` | `.put(event)`, `.get(key)`, `.list(prefix)` |
| `buildEventKey(sessionId, eventId)` | Constructs the canonical S3 key for an event |

## Dependencies

- `@aws-sdk/client-s3` — AWS SDK S3 client

## Configuration

| Env var | Description |
| ------- | ----------- |
| `EPISODIC_BUCKET` | S3 bucket name |
| `AWS_REGION` | AWS region |
| `AWS_ENDPOINT_URL` | Override for S3-compatible stores (e.g. MinIO) |
