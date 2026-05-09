/**
 * Kafka client factory. Constructs a KafkaJS Kafka instance from
 * environment-sourced configuration, suitable for both Aiven (TLS + SASL)
 * and local development (plaintext).
 */

import { Kafka, type SASLOptions, type KafkaConfig, logLevel } from "kafkajs";
import type { ConnectionOptions } from "node:tls";

export interface KafkaClientConfig {
  /** Comma-separated broker addresses, e.g. "broker1:9092,broker2:9092" */
  readonly brokers: string;
  readonly clientId: string;
  readonly ssl?: boolean | ConnectionOptions;
  readonly sasl?: SASLOptions;
}

/**
 * Builds a KafkaClientConfig from process environment variables.
 * Expected variables:
 *   KAFKA_BROKERS   — required
 *   KAFKA_CLIENT_ID — optional, defaults to "cognitive-substrate"
 *   KAFKA_SSL       — "true" to enable TLS (required for Aiven)
 *   KAFKA_SECURITY_PROTOCOL — "SSL" to enable TLS from Aiven app integration
 *   KAFKA_ACCESS_KEY
 *   KAFKA_ACCESS_CERT
 *   KAFKA_CA_CERT
 *   KAFKA_SASL_MECHANISM — "scram-sha-256" | "scram-sha-512" | "plain"
 *   KAFKA_SASL_USERNAME
 *   KAFKA_SASL_PASSWORD
 */
export function kafkaConfigFromEnv(): KafkaClientConfig {
  const brokers =
    process.env["KAFKA_BROKERS"] ??
    process.env["KAFKA_BOOTSTRAP_SERVER"];
  if (!brokers) throw new Error("KAFKA_BROKERS environment variable is required");

  const ssl = sslConfigFromEnv();
  const mechanism = process.env["KAFKA_SASL_MECHANISM"] as
    | "scram-sha-256"
    | "scram-sha-512"
    | "plain"
    | undefined;

  let sasl: SASLOptions | undefined;
  if (mechanism) {
    const username = process.env["KAFKA_SASL_USERNAME"] ?? "";
    const password = process.env["KAFKA_SASL_PASSWORD"] ?? "";
    sasl = { mechanism, username, password };
  }

  const config: KafkaClientConfig = {
    brokers,
    clientId: process.env["KAFKA_CLIENT_ID"] ?? "cognitive-substrate",
    ssl,
  };
  if (sasl) {
    return { ...config, sasl };
  }
  return config;
}

function sslConfigFromEnv(): boolean | ConnectionOptions {
  const accessKey = process.env["KAFKA_ACCESS_KEY"];
  const accessCert = process.env["KAFKA_ACCESS_CERT"];
  const caCert = process.env["KAFKA_CA_CERT"];

  if (accessKey && accessCert && caCert) {
    return {
      key: accessKey,
      cert: accessCert,
      ca: caCert,
      rejectUnauthorized: true,
    };
  }

  return (
    process.env["KAFKA_SSL"] === "true" ||
    process.env["KAFKA_SECURITY_PROTOCOL"] === "SSL"
  );
}

/** Creates a KafkaJS Kafka instance from the given config. */
export function createKafkaClient(config: KafkaClientConfig): Kafka {
  const brokerList = config.brokers.split(",").map((b) => b.trim());
  const kafkaConfig: KafkaConfig = {
    clientId: config.clientId,
    brokers: brokerList,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
    ...(config.ssl !== undefined ? { ssl: config.ssl } : {}),
    ...(config.sasl !== undefined ? { sasl: config.sasl } : {}),
  };
  return new Kafka(kafkaConfig);
}
