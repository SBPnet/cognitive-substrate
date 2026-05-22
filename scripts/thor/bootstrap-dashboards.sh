#!/usr/bin/env bash
# Bootstrap OpenSearch Dashboards index patterns and blog reader analytics dashboard.
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
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${MANIFEST:-${REPO_ROOT}/deploy/opensearch-dashboards/index-patterns.json}"
BLOG_ANALYTICS="${BLOG_ANALYTICS:-${REPO_ROOT}/deploy/opensearch-dashboards/blog-reader-analytics.json}"
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

upsert_saved_object() {
  local type="$1"
  local id="$2"
  local body="$3"
  local status
  status=$(curl -s -o /tmp/osd-bootstrap-body.json -w "%{http_code}" \
    -X POST "${DASHBOARDS_URL}/api/saved_objects/${type}/${id}?overwrite=true" \
    -H "osd-xsrf: true" \
    -H "Content-Type: application/json" \
    -d "$body")
  if [[ "$status" != "200" ]]; then
    echo "error: ${type}/${id} failed (HTTP ${status})" >&2
    cat /tmp/osd-bootstrap-body.json >&2
    return 1
  fi
}

delete_saved_object() {
  local type="$1"
  local id="$2"
  curl -s -o /dev/null -X DELETE "${DASHBOARDS_URL}/api/saved_objects/${type}/${id}" \
    -H "osd-xsrf: true" || true
}

upsert_index_pattern() {
  local id="$1"
  local title="$2"
  local time_field="$3"
  local body
  if [[ -n "$time_field" && "$time_field" != "null" ]]; then
    body=$(jq -nc \
      --arg title "$title" \
      --arg timeFieldName "$time_field" \
      '{attributes: {title: $title, timeFieldName: $timeFieldName}}')
  else
    body=$(jq -nc --arg title "$title" '{attributes: {title: $title}}')
  fi

  upsert_saved_object "index-pattern" "$id" "$body"
  if [[ -n "$time_field" && "$time_field" != "null" ]]; then
    echo "  ok  ${title} (time: ${time_field})"
  else
    echo "  ok  ${title} (no time field)"
  fi
}

bootstrap_blog_reader_analytics() {
  if [[ ! -f "$BLOG_ANALYTICS" ]]; then
    echo "==> Skipping blog reader analytics (missing ${BLOG_ANALYTICS})"
    return 0
  fi

  echo "==> Bootstrapping blog reader analytics (experience_events, tags:blog)"
  while IFS= read -r viz; do
    vid=$(jq -r '.id' <<<"$viz")
    body=$(jq -nc --argjson attrs "$(jq '.attributes' <<<"$viz")" '{attributes: $attrs}')
    upsert_saved_object "visualization" "$vid" "$body"
    echo "  ok  visualization: $(jq -r '.attributes.title' <<<"$viz")"
  done < <(jq -c '.visualizations[]' "$BLOG_ANALYTICS")

  dashboard_body=$(jq -nc \
    --argjson attrs "$(jq '.dashboard.attributes' "$BLOG_ANALYTICS")" \
    --argjson refs "$(jq '.dashboard.references' "$BLOG_ANALYTICS")" \
    '{attributes: $attrs, references: $refs}')
  dashboard_id=$(jq -r '.dashboard.id' "$BLOG_ANALYTICS")
  upsert_saved_object "dashboard" "$dashboard_id" "$dashboard_body"
  echo "  ok  dashboard: $(jq -r '.dashboard.attributes.title' "$BLOG_ANALYTICS")"
  echo "  open  ${DASHBOARDS_URL}/app/dashboards#/view/${dashboard_id}"

  while IFS= read -r deprecated_id; do
    [[ -z "$deprecated_id" ]] && continue
    delete_saved_object "dashboard" "$deprecated_id"
    delete_saved_object "search" "$deprecated_id"
    echo "  del removed legacy object: ${deprecated_id}"
  done < <(jq -r '.deprecatedSavedObjectIds[]? // empty' "$BLOG_ANALYTICS")
}

echo "==> Bootstrapping index patterns at ${DASHBOARDS_URL}"
count=0
while IFS= read -r row; do
  id=$(jq -r '.id' <<<"$row")
  title=$(jq -r '.title' <<<"$row")
  time_field=$(jq -r '.timeFieldName // empty' <<<"$row")
  desc=$(jq -r '.description // empty' <<<"$row")
  upsert_index_pattern "$id" "$title" "$time_field"
  if [[ -n "$desc" ]]; then
    echo "      ${desc}"
  fi
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

bootstrap_blog_reader_analytics

echo "==> Done (${count} index patterns)."
echo "    Reader analytics: ${DASHBOARDS_URL}/app/dashboards#/view/blog-reader-analytics"
echo "    Substrate Discover: ${DASHBOARDS_URL}/app/discover"
