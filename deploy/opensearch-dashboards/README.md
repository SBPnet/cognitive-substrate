# OpenSearch Dashboards (thor dev lab)

Optional UI for inspecting the thor OpenSearch cluster. Not used by workers, the API, or experiments (they use port 9200).

## Start on thor

```bash
docker compose -f docker-compose.thor.yml --profile dashboards up -d opensearch-dashboards
```

Browse at [http://thor:5601](http://thor:5601) (or `http://thor.local:5601`). No login on the dev lab (`DISABLE_SECURITY_DASHBOARDS_PLUGIN=true`).

## Bootstrap

Creates index patterns for substrate memory indexes plus **`blog_posts_search`** (site search catalog only).

Installs the **Blog reader analytics** dashboard on **`experience_events`** (live reader telemetry from bigpines.net).

```bash
DASHBOARDS_URL=http://thor:5601 ./scripts/thor/bootstrap-dashboards.sh
```

Re-run after a fresh Dashboards volume or cluster reprovision. Idempotent.

## Blog reader analytics (what you want for traffic)

**URL:** [http://thor:5601/app/dashboards#/view/blog-reader-analytics](http://thor:5601/app/dashboards#/view/blog-reader-analytics)

Data path:

```text
bigpines.net reader events
  → Kafka telemetry.logs.raw
  → ingest-worker (mapTelemetryToExperience)
  → experience_events  (filter: tags: blog)
```

Panels (respect Dashboards time picker, default last 30 days):

| Panel | Meaning |
|-------|---------|
| Unique sessions | Distinct `session_id` (proxy for readers) |
| Page views | `event:page_view` |
| Engagement clicks | nav, tag, repo, related article, search result, outbound, series nav |
| Article completes | `event:article_complete` |
| Activity over time | Event volume by `timestamp` |
| Events by type | Breakdown of `event:*` tags |
| Top articles | `article:*` tags by signal volume |

This is **not** `blog_posts_search` (that index is only for on-site post search metadata).

## blog_posts_search (optional)

Index pattern `blog-posts-search` lists indexed post titles for debugging the search catalog. No reader counts. In Discover, remove the time filter.

## Stop

```bash
docker compose -f docker-compose.thor.yml stop opensearch-dashboards
```

Default `docker compose -f docker-compose.thor.yml up -d` does not start Dashboards.

## Local Mac

```bash
docker compose -f docker-compose.opensearch-cluster.yml up -d
DASHBOARDS_URL=http://localhost:5601 ./scripts/thor/bootstrap-dashboards.sh
```

## Manifest files

- `index-patterns.json` — index pattern definitions
- `blog-reader-analytics.json` — visualizations + reader analytics dashboard
