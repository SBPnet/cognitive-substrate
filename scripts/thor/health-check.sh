#!/usr/bin/env bash
# Thor lab health check — OpenSearch, Kafka, app stack, and blog telemetry.
#
# Run on thor itself, or from any host on the LAN / Tailscale that can reach the
# services (default URLs use thor hostname; override via env vars).
#
# Usage (from repo root):
#   ./scripts/thor/health-check.sh
#   OPENSEARCH_URL=http://100.113.192.75:9200 ./scripts/thor/health-check.sh
#   API_URL=http://thor:4000 DASHBOARDS_URL=http://thor:5601 ./scripts/thor/health-check.sh
set -euo pipefail

OPENSEARCH_URL="${OPENSEARCH_URL:-http://thor:9200}"
API_URL="${API_URL:-http://thor:4000}"
WEB_URL="${WEB_URL:-http://thor:3000}"
DASHBOARDS_URL="${DASHBOARDS_URL:-http://thor:5601}"
SCHEMA_REGISTRY_URL="${SCHEMA_REGISTRY_URL:-http://thor:8081}"
KAFKA_BROKERS="${KAFKA_BROKERS:-thor:9092}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}OK${NC}   $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}WARN${NC} $*"; }

FAILURES=0

echo "=== Thor health check ==="
echo "OpenSearch:      ${OPENSEARCH_URL}"
echo "API:             ${API_URL}"
echo "Web:             ${WEB_URL}"
echo "Dashboards:      ${DASHBOARDS_URL}"
echo "Schema Registry: ${SCHEMA_REGISTRY_URL}"
echo "Kafka:           ${KAFKA_BROKERS}"
echo ""

# ---------------------------------------------------------------------------
# OpenSearch cluster
# ---------------------------------------------------------------------------
echo "--- OpenSearch cluster ---"
if ! HEALTH_JSON=$(curl -sf --connect-timeout 5 -m 15 "${OPENSEARCH_URL}/_cluster/health"); then
  fail "OpenSearch unreachable at ${OPENSEARCH_URL}"
else
  STATUS=$(echo "$HEALTH_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))")
  NODES=$(echo "$HEALTH_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('number_of_nodes','?'))")
  if [[ "$STATUS" == "green" || "$STATUS" == "yellow" ]]; then
    pass "cluster status=${STATUS} nodes=${NODES}"
  else
    fail "cluster status=${STATUS} nodes=${NODES}"
  fi
  curl -sf --connect-timeout 5 -m 15 "${OPENSEARCH_URL}/_cat/nodes?v&h=name,node.role,heap.percent,ram.percent,disk.used_percent" || true
fi
echo ""

# ---------------------------------------------------------------------------
# Key indexes
# ---------------------------------------------------------------------------
echo "--- OpenSearch indexes ---"
if curl -sf --connect-timeout 5 -m 15 "${OPENSEARCH_URL}/_cat/indices?v&s=index" \
  | grep -E 'experience_events|memory_semantic|substrate_proposals|agent_activity|audit_events|blog' || true; then
  :
else
  warn "could not list indexes (or none of the expected names exist yet)"
fi
echo ""

# ---------------------------------------------------------------------------
# experience_events — blog telemetry snapshot
# ---------------------------------------------------------------------------
echo "--- experience_events (blog telemetry) ---"
AGG_QUERY='{
  "size": 0,
  "aggs": {
    "total": { "value_count": { "field": "event_id.keyword" } },
    "min_ts": { "min": { "field": "timestamp" } },
    "max_ts": { "max": { "field": "timestamp" } },
    "event_tags": {
      "terms": { "field": "tags.keyword", "size": 20, "include": "event:.*" }
    },
    "blog_filter": {
      "filter": { "term": { "tags.keyword": "blog" } },
      "aggs": {
        "sessions": { "cardinality": { "field": "session_id.keyword" } },
        "article_tags": {
          "terms": { "field": "tags.keyword", "size": 30, "include": "article:.*" }
        }
      }
    },
    "seeded_vs_real": {
      "filters": {
        "filters": {
          "seeded_exp45": { "prefix": { "session_id.keyword": "exp45-" } },
          "other": { "bool": { "must_not": { "prefix": { "session_id.keyword": "exp45-" } } } }
        }
      }
    }
  }
}'

if AGG_JSON=$(curl -sf --connect-timeout 5 -m 30 -H 'Content-Type: application/json' \
  "${OPENSEARCH_URL}/experience_events/_search" -d "$AGG_QUERY" 2>/dev/null); then
  python3 - <<'PY' "$AGG_JSON"
import json, sys
from datetime import datetime, timezone

raw = sys.argv[1]
d = json.loads(raw)
aggs = d.get("aggregations", {})
total = aggs.get("total", {}).get("value", 0)
min_ts = aggs.get("min_ts", {}).get("value_as_string", "n/a")
max_ts = aggs.get("max_ts", {}).get("value_as_string", "n/a")
blog = aggs.get("blog_filter", {})
sessions = blog.get("sessions", {}).get("value", 0)
seeded = aggs.get("seeded_vs_real", {}).get("buckets", {}).get("seeded_exp45", {}).get("doc_count", 0)
other = aggs.get("seeded_vs_real", {}).get("buckets", {}).get("other", {}).get("doc_count", 0)

print(f"  total docs:        {total}")
print(f"  timestamp range:   {min_ts} → {max_ts}")
print(f"  blog sessions:     {sessions} (distinct session_id, tag=blog)")
print(f"  seeded (exp45-*):  {seeded}")
print(f"  real/other:        {other}")
print("  event types:")
for b in aggs.get("event_tags", {}).get("buckets", []):
    print(f"    {b['key']}: {b['doc_count']}")
top_articles = blog.get("article_tags", {}).get("buckets", [])[:8]
if top_articles:
    print("  top articles (by event volume):")
    for b in top_articles:
        print(f"    {b['key']}: {b['doc_count']}")
PY
  # Compare to last known baseline (Exp 45, 2026-05-19)
  TOTAL=$(echo "$AGG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['aggregations']['total']['value'])")
  if [[ "$TOTAL" -lt 100 ]]; then
    warn "doc count ${TOTAL} < 100 — ingest pipeline may be idle or index empty"
  elif [[ "$TOTAL" -eq 136 ]]; then
    warn "doc count still 136 — unchanged since Exp 45 (2026-05-19); no new traffic ingested?"
  else
    pass "doc count ${TOTAL} (baseline was 136 on 2026-05-19)"
  fi
else
  warn "experience_events index missing or query failed"
fi
echo ""

# ---------------------------------------------------------------------------
# ML models (kNN health)
# ---------------------------------------------------------------------------
echo "--- ML models ---"
if ML_JSON=$(curl -sf --connect-timeout 5 -m 15 "${OPENSEARCH_URL}/_plugins/_ml/models/_search" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match_all":{}},"size":10}' 2>/dev/null); then
  echo "$ML_JSON" | python3 -c "
import sys, json
hits = json.load(sys.stdin).get('hits', {}).get('hits', [])
if not hits:
    print('  (no models registered)')
else:
    for h in hits:
        s = h['_source']
        print(f\"  {s.get('name','?')} id={h['_id']} state={s.get('model_state','?')}\")
" || true
else
  warn "ML plugin query failed (ML node down?)"
fi
echo ""

# ---------------------------------------------------------------------------
# App stack
# ---------------------------------------------------------------------------
echo "--- App stack ---"
if curl -sf --connect-timeout 3 -m 8 "${API_URL}/health" >/dev/null 2>&1; then
  pass "API ${API_URL}/health"
else
  fail "API not reachable at ${API_URL}"
fi

WEB_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 -m 8 "${WEB_URL}" 2>/dev/null || true)
WEB_CODE=${WEB_CODE:-000}
if [[ "$WEB_CODE" =~ ^(200|301|302|307|308)$ ]]; then
  pass "Web ${WEB_URL} HTTP ${WEB_CODE}"
else
  fail "Web ${WEB_URL} HTTP ${WEB_CODE}"
fi

if curl -sf --connect-timeout 3 -m 8 "${DASHBOARDS_URL}/api/status" >/dev/null 2>&1; then
  pass "Dashboards ${DASHBOARDS_URL}"
else
  warn "Dashboards not running (optional — start with --profile dashboards)"
fi

if SUBJECTS=$(curl -sf --connect-timeout 3 -m 8 "${SCHEMA_REGISTRY_URL}/subjects" 2>/dev/null); then
  COUNT=$(echo "$SUBJECTS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
  pass "Schema Registry ${SCHEMA_REGISTRY_URL} (${COUNT} subjects)"
else
  warn "Schema Registry not reachable (deploy cp-schema-registry from latest main?)"
fi
echo ""

# ---------------------------------------------------------------------------
# Docker containers (when run on thor host)
# ---------------------------------------------------------------------------
echo "--- Docker (local host only) ---"
if command -v docker >/dev/null 2>&1; then
  RUNNING=$(docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null \
    | grep -E 'opensearch|kafka|cs-|worker' || true)
  if [[ -n "$RUNNING" ]]; then
    echo "$RUNNING" | while IFS= read -r line; do pass "$line"; done
  else
    warn "no expected containers running (or docker not accessible)"
  fi
else
  warn "docker not in PATH — skip container listing"
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "${GREEN}All critical checks passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAILURES} critical check(s) failed.${NC}"
  echo "Infra:  docker compose -f docker-compose.thor.yml up -d"
  echo "Apps:   docker compose -f docker-compose.app.yml up -d"
  exit 1
fi
