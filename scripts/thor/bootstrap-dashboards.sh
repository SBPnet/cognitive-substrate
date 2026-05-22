#!/usr/bin/env bash
# Bootstrap OpenSearch Dashboards index patterns for the cognitive memory indexes.
# Idempotent: creates or updates each pattern; safe to re-run after cluster reprovision.
#
# Prerequisites:
#   opensearch-dashboards running (thor: docker compose -f docker-compose.thor.yml --profile dashboards up -d)
#
# Usage (from repo root on thor or any host that can reach Dashboards):
#   DASHBOARDS_URL=http://thor:5601 ./scripts/thor/bootstrap-dashboards.sh
#   DASHBOARDS_URL=http://localhost:5601 ./scripts/thor/bootstrap-dashboards.sh
set -euo pipefail

DASHBOARDS_URL="${DASHBOARDS_URL:-http://localhost:5601}"
MANIFEST="${MANIFEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/deploy/opensearch-dashboards/index-patterns.json}"
DEFAULT_INDEX="${DEFAULT_INDEX:-experience_events}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "error: manifest not found: $MANIFEST" >&2
  exit 1
fi

if ! curl -sf "${DASHBOARDS_URL}/api/status" >/dev/null; then
  echo "error: OpenSearch Dashboards not reachable at ${DASHBOARDS_URL}" >&2
  echo "  thor: docker compose -f docker-compose.thor.yml --profile dashboards up -d opensearch-dashboards" >&2
  exit 1
fi

upsert_index_pattern() {
  local id="$1"
  local title="$2"
  local time_field="$3"
  local body
  body=$(jq -nc \
    --arg title "$title" \
    --arg timeFieldName "$time_field" \
    '{attributes: {title: $title, timeFieldName: $timeFieldName}}')

  local status
  status=$(curl -s -o /tmp/osd-bootstrap-body.json -w "%{http_code}" \
    -X POST "${DASHBOARDS_URL}/api/saved_objects/index-pattern/${id}?overwrite=true" \
    -H "osd-xsrf: true" \
    -H "Content-Type: application/json" \
    -d "$body")

  if [[ "$status" != "200" ]]; then
    echo "error: index-pattern ${id} failed (HTTP ${status})" >&2
    cat /tmp/osd-bootstrap-body.json >&2
    return 1
  fi
  echo "  ok  ${title} (time: ${time_field})"
}

echo "==> Bootstrapping index patterns at ${DASHBOARDS_URL}"
count=0
while IFS= read -r row; do
  id=$(jq -r '.id' <<<"$row")
  title=$(jq -r '.title' <<<"$row")
  time_field=$(jq -r '.timeFieldName' <<<"$row")
  upsert_index_pattern "$id" "$title" "$time_field"
  count=$((count + 1))
done < <(jq -c '.[]' "$MANIFEST")

echo "==> Setting default index pattern to ${DEFAULT_INDEX}"
default_body=$(jq -nc --arg defaultIndex "$DEFAULT_INDEX" '{changes: {defaultIndex: $defaultIndex}}')
status=$(curl -s -o /tmp/osd-bootstrap-body.json -w "%{http_code}" \
  -X POST "${DASHBOARDS_URL}/api/opensearch-dashboards/settings" \
  -H "osd-xsrf: true" \
  -H "Content-Type: application/json" \
  -d "$default_body")

if [[ "$status" != "200" ]]; then
  echo "warn: could not set default index (HTTP ${status}); patterns are still created" >&2
  cat /tmp/osd-bootstrap-body.json >&2
else
  echo "  ok  defaultIndex=${DEFAULT_INDEX}"
fi

echo "==> Done (${count} index patterns). Open ${DASHBOARDS_URL}/app/discover"
