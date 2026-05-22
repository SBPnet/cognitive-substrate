# ---------------------------------------------------------------------------
# Push-based telemetry integrations
#
# These integrations replace the polling loops in the aiven-collector worker:
#
#   kafka_logs   -- Aiven pushes each service's log stream into a dedicated
#                   Kafka topic; the collector consumes those topics instead
#                   of calling the REST /logs endpoint on a timer.
#
#   external_prometheus_remote_write -- Aiven pushes service metrics to the
#                   Prometheus remote_write endpoint served by the collector;
#                   no metrics polling loop is needed.
#
# Project events still arrive via the Aiven webhook (configured out-of-band
# in the Aiven console or via the aiven_project_vpc resource); the webhook
# receiver in apps/api publishes them to Kafka.
# ---------------------------------------------------------------------------

locals {
  # Services whose logs we want streamed into Kafka.
  # Add entries here as new Aiven services join the project.
  kafka_log_services = [
    aiven_kafka.cognitive_bus.service_name,
    aiven_opensearch.semantic_memory.service_name,
    aiven_clickhouse.telemetry.service_name,
  ]

  # Kafka topic prefix for log streams.  Each service gets its own topic:
  #   aiven.logs.<service-name>
  # The collector consumer group reads all topics matching this prefix.
  kafka_logs_topic_prefix = "aiven.logs"

  # Kafka topic for Aiven service metrics forwarded by the remote_write
  # receiver.  Using a separate topic keeps metric volume out of the log
  # consumer and allows independent retention policies.
  kafka_metrics_topic = "aiven.metrics"
}

# ---------------------------------------------------------------------------
# kafka_logs integrations — one per service
#
# Aiven creates a Kafka topic named "<prefix>.<service-name>" and streams
# structured log lines to it.  The integration references a
# kafka_mirrormaker_user_config block only when the topic needs custom
# retention; defaults (7d, cleanup.policy=delete) are fine here.
# ---------------------------------------------------------------------------

resource "aiven_service_integration" "kafka_logs" {
  for_each = toset(local.kafka_log_services)

  project                  = var.aiven_project
  integration_type         = "kafka_logs"
  source_service_name      = each.value
  destination_service_name = aiven_kafka.cognitive_bus.service_name

  kafka_logs_user_config {
    kafka_topic = "${local.kafka_logs_topic_prefix}.${each.value}"
  }
}

# ---------------------------------------------------------------------------
# External Prometheus remote_write integration
#
# Aiven scrapes each service's internal Prometheus endpoint and forwards
# metric samples to the collector's /metrics/write HTTP endpoint via the
# Prometheus remote_write protocol (protobuf-snappy).
#
# AIVEN_METRICS_REMOTE_WRITE_URL must be reachable from the Aiven control
# plane; in production this is the external load-balancer address of the
# aiven-collector Service.  For local dev, use a tunnel (e.g. ngrok).
#
# The `source_service_name` wildcard approach requires one integration per
# service; Aiven does not support a project-wide catch-all for remote_write.
# ---------------------------------------------------------------------------

locals {
  metrics_services = [
    aiven_kafka.cognitive_bus.service_name,
    aiven_opensearch.semantic_memory.service_name,
    aiven_clickhouse.telemetry.service_name,
  ]
}

resource "aiven_service_integration" "prometheus_remote_write" {
  for_each = toset(local.metrics_services)

  project                  = var.aiven_project
  integration_type         = "external_prometheus_remote_write"
  source_service_name      = each.value
  destination_service_name = null

  external_prometheus_remote_write_user_config {
    url = var.aiven_metrics_remote_write_url
  }
}

# ---------------------------------------------------------------------------
# Variables introduced by this file
# ---------------------------------------------------------------------------

variable "aiven_metrics_remote_write_url" {
  description = "URL of the collector's Prometheus remote_write endpoint, e.g. https://collector.example.com/metrics/write"
  type        = string
}
