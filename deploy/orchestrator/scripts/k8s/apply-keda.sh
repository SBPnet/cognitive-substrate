#!/usr/bin/env bash
# Applies KEDA TriggerAuthentication and ScaledObjects after substituting Kafka bootstrap servers.
# Prerequisites: kubectl, jq, seed-secrets.sh already run; helm install keda (see scripts/k8s/README.md)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF_OUT="${TF_OUT:-$REPO_ROOT/infra/aiven/poc-outputs.json}"

if [[ ! -f "$TF_OUT" ]]; then
  echo "ERROR: $TF_OUT not found."
  exit 1
fi

KAFKA_URI=$(jq -r '.kafka_service_uri.value' "$TF_OUT")
KAFKA_HOST=$(echo "$KAFKA_URI" | sed 's|.*://||;s|:.*||')
KAFKA_PORT=$(echo "$KAFKA_URI" | sed 's/.*://')
KAFKA_BROKERS="${KAFKA_HOST}:${KAFKA_PORT}"

TMP="$(mktemp)"
sed "s|BOOTSTRAP_SERVERS_PLACEHOLDER|${KAFKA_BROKERS}|g" \
  "$REPO_ROOT/infra/k8s/keda/scaledobjects.yaml" >"$TMP"

kubectl apply -f "$REPO_ROOT/infra/k8s/keda/trigger-auth.yaml"
kubectl apply -f "$TMP"
rm -f "$TMP"
echo "KEDA scalers applied."
