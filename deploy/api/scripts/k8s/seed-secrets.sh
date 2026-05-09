#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Seed Kubernetes secrets for Cognitive Substrate on Aiven (SCRAM + TLS) plus
# optional MinIO on the host (Colima: host.lima.internal).
#
# Prerequisites: kubectl, jq
# Usage:
#   export TF_OUT=/path/to/poc-outputs.json   # optional; defaults below
#   ./scripts/k8s/seed-secrets.sh
#
# After terraform apply:
#   cd infra/aiven && terraform output -json > poc-outputs.json
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF_OUT="${TF_OUT:-$REPO_ROOT/infra/aiven/poc-outputs.json}"
NS="${K8S_NAMESPACE:-cognitive}"

if [[ ! -f "$TF_OUT" ]]; then
  echo "ERROR: $TF_OUT not found. Run: cd infra/aiven && terraform output -json > poc-outputs.json"
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required."
  exit 1
fi

KAFKA_URI=$(jq -r '.kafka_service_uri.value' "$TF_OUT")
KAFKA_PASSWORD=$(jq -r '.kafka_app_user_password.value' "$TF_OUT")
KAFKA_HOST=$(echo "$KAFKA_URI" | sed 's|.*://||;s|:.*||')
KAFKA_PORT=$(echo "$KAFKA_URI" | sed 's/.*://')
KAFKA_BROKERS="${KAFKA_HOST}:${KAFKA_PORT}"

OPENSEARCH_URI=$(jq -r '.opensearch_uri.value' "$TF_OUT")
OPENSEARCH_HOST=$(echo "$OPENSEARCH_URI" | sed 's|https://[^@]*@||;s|:.*||')
OPENSEARCH_PORT=$(echo "$OPENSEARCH_URI" | sed 's/.*://')
OPENSEARCH_URL="https://${OPENSEARCH_HOST}:${OPENSEARCH_PORT}"
OPENSEARCH_PASSWORD=$(jq -r '.opensearch_app_user_password.value' "$TF_OUT")

CH_HOST=$(jq -r '.clickhouse_host.value' "$TF_OUT")
CH_PORT=$(jq -r '.clickhouse_port.value' "$TF_OUT")
CH_PASSWORD=$(jq -r '.clickhouse_app_user_password.value' "$TF_OUT")
CLICKHOUSE_URL="https://${CH_HOST}:${CH_PORT}"

POSTGRES_URI=$(jq -r '.postgres_uri.value' "$TF_OUT")

# MinIO on host (same ports as docker-compose.smoke.yml API port 9001)
S3_ENDPOINT="${S3_ENDPOINT:-http://host.lima.internal:9001}"
S3_BUCKET="${S3_BUCKET:-cognitive-substrate-episodic}"
S3_REGION="${S3_REGION:-us-east-1}"
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minio}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minio123}"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic cognitive-substrate-aiven \
  --from-literal=kafka-brokers="$KAFKA_BROKERS" \
  --from-literal=kafka-username=cognitive-substrate-app \
  --from-literal=kafka-password="$KAFKA_PASSWORD" \
  --from-literal=kafka-ssl="true" \
  --from-literal=kafka-sasl-mechanism="scram-sha-256" \
  --from-literal=opensearch-url="$OPENSEARCH_URL" \
  --from-literal=opensearch-username=cognitive-substrate-app \
  --from-literal=opensearch-password="$OPENSEARCH_PASSWORD" \
  --from-literal=clickhouse-url="$CLICKHOUSE_URL" \
  --from-literal=clickhouse-username=cognitive-substrate-app \
  --from-literal=clickhouse-password="$CH_PASSWORD" \
  --from-literal=clickhouse-database=cognitive_substrate_telemetry \
  --from-literal=database-url="$POSTGRES_URI" \
  --from-literal=s3-bucket="$S3_BUCKET" \
  --from-literal=s3-endpoint="$S3_ENDPOINT" \
  --from-literal=s3-region="$S3_REGION" \
  --from-literal=s3-access-key-id="$S3_ACCESS_KEY_ID" \
  --from-literal=s3-secret-access-key="$S3_SECRET_ACCESS_KEY" \
  --from-literal=s3-force-path-style="true" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic keda-kafka-auth \
  --from-literal=tls="enable" \
  --from-literal=sasl="scram_sha256" \
  --from-literal=username=cognitive-substrate-app \
  --from-literal=password="$KAFKA_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secrets applied in namespace $NS."
