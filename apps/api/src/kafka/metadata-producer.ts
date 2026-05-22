/**
 * Shared metadata producer used by the Aiven webhook receiver to publish
 * project events to TELEMETRY_METADATA_RAW without going through the
 * experience pipeline.
 */

import {
  CognitiveProducer,
  type KafkaClientConfig,
  createKafkaClient,
} from "@cognitive-substrate/kafka-bus";

let producer: CognitiveProducer | null = null;

export async function startMetadataProducer(
  kafkaConfig: KafkaClientConfig,
): Promise<() => Promise<void>> {
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: `${kafkaConfig.clientId}-metadata-producer`,
  });

  producer = new CognitiveProducer({ kafka, enableAuditMirror: false });
  await producer.connect();

  return async () => {
    if (producer) {
      await producer.disconnect();
      producer = null;
    }
  };
}

export function getMetadataProducer(): CognitiveProducer | null {
  return producer;
}
