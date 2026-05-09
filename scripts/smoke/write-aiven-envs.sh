#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/smoke/write-aiven-envs.sh
#
# Reads infra/aiven/poc-outputs.json and writes .env files for all
# apps/workers, wiring them to Aiven endpoints with SCRAM authentication.
#
# KAFKA authentication: SCRAM-SHA-256 (kafka-bus supports this natively).
# mTLS is deferred — it would require kafka-bus code changes.
#
# Usage:
#   ./scripts/smoke/write-aiven-envs.sh
#
# Prerequisites:
#   - jq installed
#   - infra/aiven/poc-outputs.json exists (run terraform output -json first)
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUTS="$REPO_ROOT/infra/aiven/poc-outputs.json"

if [[ ! -f "$OUTPUTS" ]]; then
  echo "ERROR: $OUTPUTS not found. Run: terraform output -json > poc-outputs.json"
  exit 1
fi
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

# ---- Extract values -------------------------------------------------------
KAFKA_URI=$(jq -r '.kafka_service_uri.value' "$OUTPUTS")
KAFKA_HOST=$(echo "$KAFKA_URI" | sed 's|.*://||;s|:.*||')
KAFKA_PORT=$(echo "$KAFKA_URI" | sed 's/.*://')
KAFKA_BROKERS="${KAFKA_HOST}:${KAFKA_PORT}"
KAFKA_PASSWORD=$(jq -r '.kafka_app_user_password.value' "$OUTPUTS")

# OpenSearch URI format: https://user:password@host:port
OPENSEARCH_URI=$(jq -r '.opensearch_uri.value' "$OUTPUTS")
OPENSEARCH_HOST=$(echo "$OPENSEARCH_URI" | sed 's|https://[^@]*@||;s|:.*||')
OPENSEARCH_PORT=$(echo "$OPENSEARCH_URI" | sed 's/.*://')
OPENSEARCH_URL="https://${OPENSEARCH_HOST}:${OPENSEARCH_PORT}"
OPENSEARCH_PASSWORD=$(jq -r '.opensearch_app_user_password.value' "$OUTPUTS")

CH_HOST=$(jq -r '.clickhouse_host.value' "$OUTPUTS")
CH_PORT=$(jq -r '.clickhouse_port.value' "$OUTPUTS")
CH_PASSWORD=$(jq -r '.clickhouse_app_user_password.value' "$OUTPUTS")
CH_URL="https://${CH_HOST}:${CH_PORT}"

POSTGRES_URI=$(jq -r '.postgres_uri.value' "$OUTPUTS")

log() { echo "[aiven-envs] $*"; }

# ---- Common Kafka block ----------------------------------------------------
kafka_env() {
  cat <<EOF
KAFKA_BROKERS=${KAFKA_BROKERS}
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=cognitive-substrate-app
KAFKA_SASL_PASSWORD=${KAFKA_PASSWORD}
KAFKA_CLIENT_ID=${1}
EOF
}

# ---- Common OpenSearch block -----------------------------------------------
opensearch_env() {
  cat <<EOF
OPENSEARCH_URL=${OPENSEARCH_URL}
OPENSEARCH_USERNAME=cognitive-substrate-app
OPENSEARCH_PASSWORD=${OPENSEARCH_PASSWORD}
EOF
}

# ---- Common ClickHouse block -----------------------------------------------
clickhouse_env() {
  cat <<EOF
CLICKHOUSE_HOST=${CH_HOST}
CLICKHOUSE_PORT=${CH_PORT}
CLICKHOUSE_USERNAME=cognitive-substrate-app
CLICKHOUSE_PASSWORD=${CH_PASSWORD}
CLICKHOUSE_DATABASE=cognitive_substrate_telemetry
EOF
}

# ---- Helper: write env file ------------------------------------------------
write_env() {
  local path="$1"
  local content="$2"
  echo "$content" > "$path"
  log "Wrote $path"
}

# ---- API ------------------------------------------------------------------
write_env "$REPO_ROOT/apps/api/.env" "$(kafka_env "api")
$(opensearch_env)
PORT=3001
OTEL_SERVICE_NAME=api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
KAFKA_GROUP_ID=api-gateway"

# ---- Web ------------------------------------------------------------------
write_env "$REPO_ROOT/apps/web/.env" "NEXT_PUBLIC_API_URL=http://localhost:3001"

# ---- Orchestrator ---------------------------------------------------------
write_env "$REPO_ROOT/apps/orchestrator/.env" "$(kafka_env "orchestrator")
$(opensearch_env)
DATABASE_URL=${POSTGRES_URI}
EMBEDDING_DIMENSION=1536
OTEL_SERVICE_NAME=orchestrator
KAFKA_GROUP_ID=orchestrators"

# ---- Ingestion worker -----------------------------------------------------
write_env "$REPO_ROOT/apps/workers/ingestion/.env" "$(kafka_env "ingestion-worker")
$(opensearch_env)
S3_ENDPOINT=http://localhost:9001
S3_BUCKET=cognitive-substrate-episodic
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio123
OTEL_SERVICE_NAME=ingestion-worker
KAFKA_GROUP_ID=ingestion-workers"

# ---- Consolidation worker -------------------------------------------------
write_env "$REPO_ROOT/apps/workers/consolidation/.env" "$(kafka_env "consolidation-worker")
$(opensearch_env)
OTEL_SERVICE_NAME=consolidation-worker
KAFKA_GROUP_ID=consolidation-workers"

# ---- Telemetry worker -----------------------------------------------------
write_env "$REPO_ROOT/apps/workers/telemetry/.env" "$(kafka_env "telemetry-worker")
$(clickhouse_env)
OTEL_SERVICE_NAME=telemetry-worker
KAFKA_GROUP_ID=telemetry-workers
ENVIRONMENT=dev"

# ---- Pattern worker -------------------------------------------------------
write_env "$REPO_ROOT/apps/workers/pattern/.env" "$(kafka_env "pattern-worker")
$(opensearch_env)
$(clickhouse_env)
OTEL_SERVICE_NAME=pattern-worker
KAFKA_GROUP_ID=pattern-workers
ENVIRONMENT=dev"

# ---- Reinforcement worker -------------------------------------------------
write_env "$REPO_ROOT/apps/workers/reinforcement/.env" "$(kafka_env "reinforcement-worker")
$(opensearch_env)
$(clickhouse_env)
OTEL_SERVICE_NAME=reinforcement-worker
KAFKA_GROUP_ID=reinforcement-workers
ENVIRONMENT=dev"

log "Done. All .env files written with Aiven endpoints."
log "Kafka (SCRAM): ${KAFKA_BROKERS}"
log "OpenSearch:    ${OPENSEARCH_URL}"
log "ClickHouse:    ${CH_URL}"
log ""
log "Next step: pnpm -r build && ./scripts/smoke/up.sh (apps only, infra on Aiven)"
