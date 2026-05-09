#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/smoke/up.sh — full local smoke-test bring-up
#
# Starts all backing infrastructure via docker-compose.smoke.yml, initialises
# Kafka topics and ClickHouse tables, then launches all 8 Node services in
# background terminals using concurrently (installed on demand).
#
# Prerequisites:
#   - Colima or Docker Desktop running: colima start --cpu 6 --memory 12
#   - pnpm installed
#   - Node 22 LTS recommended. Node 25 produces TimeoutNegativeWarning from
#     kafkajs@2.2.4 internals; this is an upstream kafkajs bug and is not
#     suppressed here so other runtime warnings remain visible.
#
# Usage:
#   ./scripts/smoke/up.sh                  # bring up everything
#   ./scripts/smoke/up.sh --down           # tear down infra (keeps app processes)
#   ./scripts/smoke/up.sh --kill-apps      # kill only smoke app processes on ports
# ---------------------------------------------------------------------------
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker-compose.smoke.yml"

# App ports owned by the smoke stack.
SMOKE_APP_PORTS=(3000 3001)

# ----------------------------------------------------------------
# Helper: check whether a port is in use; print PID+command if so.
# Returns 0 (occupied) or 1 (free).
# ----------------------------------------------------------------
port_occupied() {
  local port="$1"
  local info
  info=$(lsof -iTCP:"$port" -sTCP:LISTEN -Fp 2>/dev/null | head -1 || true)
  if [[ -n "$info" ]]; then
    local pid="${info#p}"
    local cmd
    cmd=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
    echo "[smoke] Port $port occupied by PID $pid ($cmd)"
    return 0
  fi
  return 1
}

if [[ "${1:-}" == "--down" ]]; then
  echo "[smoke] Tearing down..."
  docker compose -f "$COMPOSE_FILE" down -v
  echo "[smoke] Done."
  exit 0
fi

if [[ "${1:-}" == "--kill-apps" ]]; then
  echo "[smoke] Killing smoke app processes on ports ${SMOKE_APP_PORTS[*]}..."
  for port in "${SMOKE_APP_PORTS[@]}"; do
    pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      echo "[smoke] Killing PID(s) $pids on port $port"
      # shellcheck disable=SC2086
      kill -TERM $pids 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -KILL $pids 2>/dev/null || true
    else
      echo "[smoke] Port $port is free."
    fi
  done
  echo "[smoke] Done."
  exit 0
fi

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
if [[ "$node_major" != "22" ]]; then
  echo "[smoke] Node 22 LTS is required for local smoke runs."
  echo "[smoke] Current Node version: $(node --version 2>/dev/null || echo "not found")"
  echo "[smoke] Run 'nvm use' from the repository root, or install Node 22 first."
  echo "[smoke] This avoids Node 25 TimeoutNegativeWarning noise from kafkajs internals."
  exit 1
fi

# ----------------------------------------------------------------
# 1. Build all packages (idempotent)
# ----------------------------------------------------------------
echo "[smoke] Installing deps and running all-package baseline..."
pnpm install --frozen-lockfile
pnpm smoke:packages

# ----------------------------------------------------------------
# 2. Copy .env examples if .env files don't exist yet
# ----------------------------------------------------------------
copy_env() {
  local dir="$1"
  if [[ ! -f "$dir/.env" && -f "$dir/.env.example" ]]; then
    cp "$dir/.env.example" "$dir/.env"
    echo "[smoke] Copied $dir/.env.example -> .env (edit as needed)"
  fi
}
copy_env apps/workers/ingestion
copy_env apps/workers/consolidation
copy_env apps/workers/telemetry
copy_env apps/workers/pattern
copy_env apps/workers/reinforcement
copy_env apps/orchestrator
copy_env apps/api
copy_env apps/web

# ----------------------------------------------------------------
# 3. Start backing services
# ----------------------------------------------------------------
echo "[smoke] Starting infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d

# ----------------------------------------------------------------
# 4. Wait for healthchecks
# ----------------------------------------------------------------
echo "[smoke] Waiting for OpenSearch (port 9200)..."
until curl -sf http://localhost:9200/_cluster/health > /dev/null 2>&1; do
  printf "."
  sleep 3
done
echo " ready."

echo "[smoke] Waiting for ClickHouse (port 8123)..."
until curl -sf http://localhost:8123/ping > /dev/null 2>&1; do
  printf "."
  sleep 2
done
echo " ready."

echo "[smoke] Waiting for Kafka (port 9092)..."
until docker compose -f "$COMPOSE_FILE" exec kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 --list > /dev/null 2>&1; do
  printf "."
  sleep 3
done
echo " ready."

# ----------------------------------------------------------------
# 5. Initialise Kafka topics
# ----------------------------------------------------------------
echo "[smoke] Creating Kafka topics..."
KAFKA_BROKERS=localhost:9092 pnpm tsx scripts/smoke/init-kafka-topics.ts

# ----------------------------------------------------------------
# 6. Initialise ClickHouse tables
# ----------------------------------------------------------------
echo "[smoke] Creating ClickHouse tables..."
CLICKHOUSE_URL=http://localhost:8123 \
  CLICKHOUSE_DATABASE=cognitive_substrate_telemetry \
  pnpm tsx scripts/smoke/init-clickhouse.ts

# ----------------------------------------------------------------
# 7. Preflight: ensure app ports are free before launching
# ----------------------------------------------------------------
echo "[smoke] Checking app ports..."
port_conflict=0
for port in "${SMOKE_APP_PORTS[@]}"; do
  if port_occupied "$port"; then
    port_conflict=1
  fi
done
if [[ "$port_conflict" -eq 1 ]]; then
  echo "[smoke] One or more app ports are occupied."
  echo "[smoke] Run './scripts/smoke/up.sh --kill-apps' to release them, then retry."
  exit 1
fi
echo "[smoke] App ports are free."

# ----------------------------------------------------------------
# 8. Launch all 8 services with concurrently
# ----------------------------------------------------------------
echo "[smoke] Launching applications..."

# Install concurrently if not present in the workspace
if ! pnpm exec concurrently --version > /dev/null 2>&1; then
  pnpm add -D concurrently -w
fi

# Existing .env files may point at hosted services. Local smoke always targets the
# compose stack, so these values intentionally override per-service files.
load_smoke_env='set -a; . ./.env; set +a; unset CLICKHOUSE_HOST CLICKHOUSE_PORT OPENSEARCH_USERNAME OPENSEARCH_PASSWORD KAFKA_SASL_MECHANISM KAFKA_SASL_USERNAME KAFKA_SASL_PASSWORD OPENAI_API_KEY; export KAFKA_BROKERS=localhost:9092 KAFKA_SSL=false KAFKAJS_NO_PARTITIONER_WARNING=1 OPENSEARCH_URL=http://localhost:9200 OPENSEARCH_TLS_REJECT_UNAUTHORIZED=false CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_DATABASE=cognitive_substrate_telemetry CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD= S3_BUCKET=cognitive-substrate-episodic S3_REGION=us-east-1 S3_ENDPOINT=http://localhost:9001 S3_ACCESS_KEY_ID=minio S3_SECRET_ACCESS_KEY=minio123 S3_FORCE_PATH_STYLE=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 EMBEDDING_PROVIDER=stub;'

# Each service gets a dotenv file from its own directory.
# Use --kill-others-on-fail so a fatal boot error shuts the whole group.
pnpm exec concurrently \
  --kill-others-on-fail \
  --names "ing,cons,tel,pat,rein,orch,api,web" \
  --prefix-colors "cyan,yellow,blue,magenta,red,green,white,gray" \
  "cd apps/workers/ingestion && $load_smoke_env node dist/main.js" \
  "cd apps/workers/consolidation && $load_smoke_env node dist/main.js" \
  "cd apps/workers/telemetry && $load_smoke_env node dist/main.js" \
  "cd apps/workers/pattern && $load_smoke_env node dist/main.js" \
  "cd apps/workers/reinforcement && $load_smoke_env node dist/main.js" \
  "cd apps/orchestrator && $load_smoke_env node dist/main.js" \
  "cd apps/api && $load_smoke_env node dist/main.js" \
  "cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm dev"

# concurrently blocks until all processes exit (Ctrl-C stops them all).
echo "[smoke] All services stopped."
echo ""
echo "[smoke] Smoke helpers (run in a separate terminal while the stack is up):"
echo "  Feed experiences:     KAFKA_BROKERS=localhost:9092 OPENSEARCH_URL=http://localhost:9200 API_URL=http://localhost:3001 pnpm tsx scripts/smoke/feed-experiences.ts"
echo "  Trigger consolidation: KAFKA_BROKERS=localhost:9092 pnpm tsx scripts/smoke/request-consolidation.ts"
