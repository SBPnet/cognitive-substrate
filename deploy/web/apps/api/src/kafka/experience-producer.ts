/**
 * Thin wrapper used by message routes to publish ExperienceEvents
 * to `experience.raw` on behalf of the user session.
 */

import type { ExperienceEvent } from "@cognitive-substrate/core-types";
import {
  CognitiveProducer,
  Topics,
  type KafkaClientConfig,
  createKafkaClient,
} from "@cognitive-substrate/kafka-bus";

let producer: CognitiveProducer | null = null;

export async function startExperienceProducer(
  kafkaConfig: KafkaClientConfig,
): Promise<() => Promise<void>> {
  const kafka = createKafkaClient({
    ...kafkaConfig,
    clientId: `${kafkaConfig.clientId}-producer`,
  });

  producer = new CognitiveProducer({ kafka, enableAuditMirror: true });
  await producer.connect();

  return async () => {
    if (producer) {
      await producer.disconnect();
      producer = null;
    }
  };
}

export async function publishExperienceEvent(
  event: ExperienceEvent,
  traceContext?: { traceId: string; spanId: string },
): Promise<void> {
  if (!producer) throw new Error("Experience producer is not started");

  const options = traceContext
    ? {
        key: event.eventId,
        traceContext: {
          version: "00" as const,
          traceId: traceContext.traceId,
          parentId: traceContext.spanId,
          traceFlags: "01" as const,
        },
      }
    : { key: event.eventId };

  await producer.publish(Topics.EXPERIENCE_RAW, event, options);
}
