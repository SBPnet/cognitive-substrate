#!/usr/bin/env bash
# Run once on thor to generate TLS certs and SCRAM credentials for Kafka.
# Usage: bash kafka-tls-setup/setup.sh [password]
# Default password: kafkapass  (change before production use)
set -euo pipefail

PASSWORD="${1:-kafkapass}"
HOSTNAME="thor.bigpines.net"
DIR="$HOME/kafka-tls"

echo "==> Creating $DIR"
mkdir -p "$DIR"
cd "$DIR"

echo "==> Generating CA key and cert"
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt -subj "/CN=kafka-ca"

echo "==> Generating broker key and signed cert (SAN: $HOSTNAME)"
openssl genrsa -out broker.key 4096
openssl req -new -key broker.key -out broker.csr -subj "/CN=$HOSTNAME"
openssl x509 -req -days 3650 -in broker.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out broker.crt \
  -extfile <(printf "subjectAltName=DNS:%s" "$HOSTNAME")

echo "==> Building PKCS12 and JKS keystores"
openssl pkcs12 -export -in broker.crt -inkey broker.key -chain \
  -CAfile ca.crt -name broker -out broker.p12 -passout "pass:$PASSWORD"

keytool -importkeystore -srckeystore broker.p12 -srcstoretype PKCS12 \
  -srcstorepass "$PASSWORD" -destkeystore broker.keystore.jks \
  -deststorepass "$PASSWORD" -noprompt

keytool -importcert -file ca.crt -keystore broker.truststore.jks \
  -storepass "$PASSWORD" -alias CARoot -noprompt

echo "==> Writing credential files"
echo "$PASSWORD" > keystore_creds
echo "$PASSWORD" > truststore_creds
chmod 600 keystore_creds truststore_creds ca.key broker.key

echo "==> Copying JAAS config"
# Repo path relative to where this script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/kafka_server_jaas.conf" "$DIR/kafka_server_jaas.conf"
# Substitute password into JAAS file
sed -i "s/CHANGEME/$PASSWORD/g" "$DIR/kafka_server_jaas.conf"

echo ""
echo "==> Done. Files in $DIR:"
ls -lh "$DIR"
echo ""
echo "Next steps:"
echo "  1. Add a DNS A record: thor.bigpines.net -> \$(curl -s ifconfig.me)"
echo "  2. Forward TCP 9092 on your router to 192.168.1.109"
echo "  3. sudo ufw allow 9092/tcp"
echo "  4. Copy ca.crt to the blog VPS and ingest-worker machines"
echo "     (clients need it to verify the broker cert)"
echo "  5. docker compose -f docker-compose.thor.yml up -d kafka"
echo "  6. Create SCRAM user inside the broker:"
echo "     docker exec kafka /opt/kafka/bin/kafka-configs.sh \\"
echo "       --bootstrap-server localhost:9094 --alter --add-config \\"
echo "       'SCRAM-SHA-512=[iterations=8192,password=$PASSWORD]' \\"
echo "       --entity-type users --entity-name blog"
