# Deploy assets

Runtime images are built from Dockerfiles next to each app (repo root as build context):

| Service | Dockerfile |
|---------|------------|
| API | `apps/api/Dockerfile` |
| Orchestrator | `apps/orchestrator/Dockerfile` |
| Web | `apps/web/Dockerfile` |
| Workers | `apps/workers/<name>/Dockerfile` |

Thor app stack: `docker compose -f docker-compose.app.yml build` (from repo root).

## OpenSearch Dashboards

`opensearch-dashboards/` holds index-pattern manifests and bootstrap notes for the thor dashboards profile. See [opensearch-dashboards/README.md](./opensearch-dashboards/README.md).
