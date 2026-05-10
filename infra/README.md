# Infrastructure layout

Application code talks to **Kafka-compatible brokers**, **OpenSearch-compatible**
HTTP endpoints, **S3-compatible** storage, **PostgreSQL**, and **ClickHouse**
via environment variables. Nothing here replaces those contracts: these folders
are **examples** of how to provision compatible backends.

## What lives here

| Path | Purpose |
|------|---------|
| **`../docker-compose.smoke.yml`** (repo root) | OSS-only local stack for development and `pnpm smoke:deep`. Not vendor-specific. |
| **`aiven/`** | Example Terraform for one managed stack (Kafka, OpenSearch, Postgres, ClickHouse). Optional; swap for your own IaC. |
| **`k8s/`** | Kubernetes manifests and KEDA scalers for running workers and apps; expects compatible services via secrets/config. |
| **`opensearch/`**, **`kafka/`** | Index templates, topics, ACLs—shape of the pipeline, not a hosting choice. |

Adding another cloud usually means **new Terraform or Helm** beside `aiven/`, not
changes to the TypeScript packages, as long as URLs and credentials match the
same protocols.
