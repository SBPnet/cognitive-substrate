# OpenSearch Dashboards (thor dev lab)

Optional UI for inspecting the thor OpenSearch cluster. Not used by workers, the API, or experiments (they use port 9200).

## Start on thor

```bash
docker compose -f docker-compose.thor.yml --profile dashboards up -d opensearch-dashboards
```

Browse at `http://thor:5601`.

## Bootstrap index patterns

Creates index patterns for all cognitive memory indexes defined in `packages/memory-opensearch/src/schemas.ts`.

```bash
DASHBOARDS_URL=http://thor:5601 ./scripts/thor/bootstrap-dashboards.sh
```

Re-run after a fresh Dashboards volume or cluster reprovision. The script is idempotent.

## Stop

```bash
docker compose -f docker-compose.thor.yml stop opensearch-dashboards
```

Default `docker compose -f docker-compose.thor.yml up -d` does not start Dashboards.
