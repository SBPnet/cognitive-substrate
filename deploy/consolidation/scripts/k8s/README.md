# Kubernetes (Colima k3s) against Aiven

This runbook deploys Cognitive Substrate workloads into a local **k3s** cluster (e.g. Colima with Kubernetes) while Kafka, OpenSearch, PostgreSQL, and ClickHouse stay on **Aiven**. Object storage uses **MinIO** on the host ([docker-compose.smoke.yml](../../docker-compose.smoke.yml)); pods reach it via `host.lima.internal` (see [seed-secrets.sh](./seed-secrets.sh) defaults).

## Prerequisites

- Colima with Kubernetes, or another cluster where locally built images can be loaded.
- `kubectl`, `jq`, `docker` (or Colima Docker context).
- Terraform outputs after `terraform apply` in `infra/aiven`: `infra/aiven/poc-outputs.json`.
- Optional: [Helm](https://helm.sh/) for KEDA.

## 1. Terraform outputs

```bash
cd infra/aiven
terraform apply -var-file=poc.auto.tfvars
terraform output -json > poc-outputs.json
```

## 2. Secrets

```bash
./scripts/k8s/seed-secrets.sh
```

Override paths with `TF_OUT=/path/to/poc-outputs.json` and `K8S_NAMESPACE=cognitive` if needed.

## 3. Build images (repo root, Colima Docker context)

Use `imagePullPolicy: Never` and tags expected by manifests (`cognitive-substrate/<name>:latest`).

```bash
docker context use colima
cd /path/to/cognitive-substrate

docker build -f apps/api/Dockerfile -t cognitive-substrate/api:latest .
docker build -f apps/web/Dockerfile -t cognitive-substrate/web:latest .
docker build -f apps/orchestrator/Dockerfile -t cognitive-substrate/orchestrator:latest .
docker build -f apps/workers/ingestion/Dockerfile -t cognitive-substrate/ingestion-worker:latest .
docker build -f apps/workers/consolidation/Dockerfile -t cognitive-substrate/consolidation-worker:latest .
docker build -f apps/workers/telemetry/Dockerfile -t cognitive-substrate/telemetry-worker:latest .
docker build -f apps/workers/pattern/Dockerfile -t cognitive-substrate/pattern-worker:latest .
docker build -f apps/workers/reinforcement/Dockerfile -t cognitive-substrate/reinforcement-worker:latest .
```

**Web / `NEXT_PUBLIC_API_URL`:** The browser talks to the API through port-forward. Bake the API URL at **image build** time (Next.js):

```bash
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -t cognitive-substrate/web:latest .
```

## 4. Load images into k3s (Colima)

```bash
docker save \
  cognitive-substrate/api:latest \
  cognitive-substrate/web:latest \
  cognitive-substrate/orchestrator:latest \
  cognitive-substrate/ingestion-worker:latest \
  cognitive-substrate/consolidation-worker:latest \
  cognitive-substrate/telemetry-worker:latest \
  cognitive-substrate/pattern-worker:latest \
  cognitive-substrate/reinforcement-worker:latest \
  | colima ssh -- sudo k3s ctr images import -
```

If `ctr` path differs on the installation, use the same pattern as in Colima docs for importing OCI tarballs.

## 5. Apply manifests

```bash
kubectl apply -k infra/k8s
```

## 6. KEDA (optional)

Install once per cluster:

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

After workloads and secrets exist:

```bash
./scripts/k8s/apply-keda.sh
```

## 7. Port forward

```bash
kubectl -n cognitive port-forward svc/cognitive-substrate-web 3000:3000 &
kubectl -n cognitive port-forward svc/cognitive-substrate-api 3001:3001 &
```

Open `http://localhost:3000`.

## 8. Notes

- **Ingestion worker** may require `OPENAI_API_KEY` for embeddings; add via Secret patch or Deployment env if needed.
- **`imagePullPolicy: Never`** is for local images only; switch to `IfNotPresent` when pulling from a registry.
- **Teardown:** `kubectl delete namespace cognitive`; optional `terraform destroy` in `infra/aiven`; `colima stop`.
