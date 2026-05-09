import type { PolicyEvaluationInput } from "@cognitive-substrate/policy-engine";
import type { CognitiveProducer } from "@cognitive-substrate/kafka-bus";
import { Topics } from "@cognitive-substrate/kafka-bus";
import type { PolicyEvaluationPublisher } from "@cognitive-substrate/agents";

export class KafkaPolicyEvaluationPublisher implements PolicyEvaluationPublisher {
  private readonly producer: CognitiveProducer;

  constructor(producer: CognitiveProducer) {
    this.producer = producer;
  }

  async publish(input: PolicyEvaluationInput): Promise<void> {
    await this.producer.publish(Topics.POLICY_EVALUATION, input, {
      key: input.sourceExperienceId,
    });
  }
}
