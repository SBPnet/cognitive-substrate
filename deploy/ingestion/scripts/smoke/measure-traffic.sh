#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/smoke/measure-traffic.sh
#
# Measure laptop network bytes before/after a smoke run.
# Also prints Aiven-side guidance for pairing with aiven_service_metrics_fetch.
#
# Usage:
#   IFACE=en0 ./scripts/smoke/measure-traffic.sh idle     # 60s baseline
#   IFACE=en0 SAMPLE_SECS=300 ./scripts/smoke/measure-traffic.sh smoke
#
# Results are printed to stdout; redirect to append to traffic-baseline.md:
#   ./scripts/smoke/measure-traffic.sh idle >> scripts/smoke/traffic-baseline.md
#
# Environment variables:
#   IFACE        Network interface to measure (default: en0)
#   SAMPLE_SECS  How long to measure in seconds (default: 60)
# ---------------------------------------------------------------------------
set -euo pipefail

IFACE="${IFACE:-en0}"
LABEL="${1:-baseline}"
SAMPLE_SECS="${SAMPLE_SECS:-60}"

# macOS: netstat -ib gives cumulative byte counters per interface.
# Column positions: Ibytes=7, Obytes=10 (1-indexed, split by whitespace).
snapshot() {
  netstat -ib | awk -v iface="$IFACE" '
    $1 == iface && NF >= 10 { print $7 " " $10; exit }
  '
}

read -r RX1 TX1 < <(snapshot)
if [[ -z "$RX1" || -z "$TX1" ]]; then
  echo "ERROR: interface '$IFACE' not found in netstat -ib output."
  echo "Available interfaces:"
  netstat -ib | awk 'NR>1 && NF>=10 { print "  " $1 }' | sort -u
  exit 1
fi

echo ""
echo "## Traffic measurement: $LABEL"
echo "Interface : $IFACE"
echo "Duration  : ${SAMPLE_SECS}s"
echo "Started   : $(date -Iseconds)"
echo "RX start  : $RX1 bytes"
echo "TX start  : $TX1 bytes"
echo ""
echo "Sampling for ${SAMPLE_SECS}s — run your smoke interactions now..."
sleep "$SAMPLE_SECS"

read -r RX2 TX2 < <(snapshot)
echo ""
echo "Finished  : $(date -Iseconds)"
echo "RX end    : $RX2 bytes"
echo "TX end    : $TX2 bytes"
echo ""

RX_DELTA=$(( RX2 - RX1 ))
TX_DELTA=$(( TX2 - TX1 ))
TOTAL_DELTA=$(( RX_DELTA + TX_DELTA ))

echo "### Delta"
echo "RX delta  : $(numfmt --to=iec-i --suffix=B "$RX_DELTA" 2>/dev/null || echo "${RX_DELTA} bytes")"
echo "TX delta  : $(numfmt --to=iec-i --suffix=B "$TX_DELTA" 2>/dev/null || echo "${TX_DELTA} bytes")"
echo "Total     : $(numfmt --to=iec-i --suffix=B "$TOTAL_DELTA" 2>/dev/null || echo "${TOTAL_DELTA} bytes")"
echo ""

echo "### Aiven-side counters (run in the IDE agent / MCP):"
echo ""
echo "To see Kafka bytes-in/bytes-out:"
echo '  aiven_service_metrics_fetch { project: "<project>", service_name: "cognitive-substrate-kafka-dev", period: "hour" }'
echo ""
echo "To count messages on experience.raw:"
echo '  aiven_kafka_topic_message_list { project: "<project>", service_name: "cognitive-substrate-kafka-dev", topic_name: "experience.raw" }'
echo ""
echo "To see OpenSearch indexing rate:"
echo '  aiven_service_metrics_fetch { project: "<project>", service_name: "cognitive-substrate-opensearch-dev", period: "hour" }'
