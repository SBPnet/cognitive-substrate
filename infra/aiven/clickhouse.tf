locals {
  clickhouse_service_name = "cognitive-substrate-clickhouse-${var.environment}"
}

# ------------------------------------------------------------------
# ClickHouse service — temporal telemetry intelligence layer
#
# Role in the architecture:
#   PostgreSQL  → canonical business truth (config, topology, policies)
#   OpenSearch  → semantic / associative memory (vectors, patterns)
#   ClickHouse  → temporal experience memory (metrics, logs, traces,
#                 cognitive events, pattern outcomes)
#
# ClickHouse is the append-only analytical engine for all high-cardinality
# time-series telemetry and the reinforcement learning substrate.  Queries
# are aggregation-heavy, retention is long, and write throughput can exceed
# millions of rows/hour at 1 000+ service scale.
# ------------------------------------------------------------------

resource "aiven_clickhouse" "telemetry" {
  project      = var.aiven_project
  cloud_name   = var.cloud_name
  plan         = var.clickhouse_plan
  service_name = local.clickhouse_service_name

  timeouts {
    create = "30m"
    update = "20m"
  }
}

# ------------------------------------------------------------------
# Database
# ------------------------------------------------------------------

resource "aiven_clickhouse_database" "telemetry" {
  project      = var.aiven_project
  service_name = aiven_clickhouse.telemetry.service_name
  name         = "cognitive_substrate_telemetry"
}

# ------------------------------------------------------------------
# Application user
# ------------------------------------------------------------------

resource "aiven_clickhouse_user" "app" {
  project      = var.aiven_project
  service_name = aiven_clickhouse.telemetry.service_name
  username     = "cognitive-substrate-app"
}

# ------------------------------------------------------------------
# Kafka → ClickHouse service integration
#
# Aiven's managed Kafka connector streams telemetry.* topic data
# directly into ClickHouse without a separate Kafka Connect cluster.
# The telemetry worker also writes via the HTTP interface for enriched
# rows that need normalisation before persistence.
# ------------------------------------------------------------------

resource "aiven_service_integration" "kafka_to_clickhouse" {
  project                  = var.aiven_project
  integration_type         = "clickhouse_kafka"
  source_service_name      = aiven_kafka.cognitive_bus.service_name
  destination_service_name = aiven_clickhouse.telemetry.service_name
}
