# @cognitive-substrate/aiven-client

Shared HTTP base client and service types for Aiven control-plane and data-plane integration.

## What it does

Provides a thin authenticated wrapper around the Aiven API so other packages and workers can list, inspect, and manage Aiven services (Kafka, OpenSearch, etc.) without duplicating auth logic or error handling.

## API

```ts
import { AivenBaseClient, AivenService } from '@cognitive-substrate/aiven-client';

const client = new AivenBaseClient({ token: process.env.AIVEN_TOKEN, project: 'my-project' });
const services: AivenService[] = await client.listServices();
```

### Key exports

| Export | Description |
| ------ | ----------- |
| `AivenBaseClient` | Authenticated fetch wrapper; `.listServices()`, `.getService(name)` |
| `AivenService` | Type describing a single Aiven service (name, type, state, connection info) |

## Dependencies

None — pure HTTP + types, no intra-monorepo dependencies.

## Configuration

| Env var | Description |
| ------- | ----------- |
| `AIVEN_TOKEN` | Personal or service account token |
| `AIVEN_PROJECT` | Aiven project name |
