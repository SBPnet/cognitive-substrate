import { randomUUID } from "node:crypto";
import type { Client } from "@opensearch-project/opensearch";
import { indexDocument } from "@cognitive-substrate/memory-opensearch";
import type { ProposalRecord, ProposalStore } from "./proposal-store.js";

/**
 * Applies an approved self-modification proposal and writes a
 * schema_evolution event back to experience_events so the reinforcement
 * loop can later score whether the observedGain matched expectedGain.
 */
export class SchemaEvolutionApplier {
  constructor(
    private readonly client: Client,
    private readonly store: ProposalStore,
  ) {}

  async apply(record: ProposalRecord): Promise<void> {
    const { proposal } = record;

    switch (proposal.mutationType) {
      case 'parameter_tune':
        // Parameter tuning is advisory: log the recommended change so an
        // operator can apply it. Runtime config changes require a restart.
        process.stdout.write(
          `[schema-evolution] parameter_tune: engine=${
            (proposal.payload as { engine?: string }).engine ?? 'unknown'
          } parameter=${
            (proposal.payload as { parameter?: string }).parameter ?? 'unknown'
          } proposed=${
            (proposal.payload as { proposedValue?: number }).proposedValue ?? 'n/a'
          }\n`,
        );
        break;

      case 'plugin_register':
      case 'plugin_update': {
        const pluginPayload = proposal.payload as { pluginSourceType?: string; specDescription?: string };
        process.stdout.write(
          `[schema-evolution] ${proposal.mutationType}: sourceType=${pluginPayload.pluginSourceType ?? 'unknown'} — restart required to activate\n`,
        );
        process.stdout.write(
          `[schema-evolution] spec: ${pluginPayload.specDescription ?? ''}\n`,
        );
        break;
      }

      case 'index_mapping':
      case 'metric_capture': {
        const mappingPayload = proposal.payload as {
          indexName?: string;
          fieldName?: string;
          fieldType?: string;
        };
        const indexName = mappingPayload.indexName ?? 'experience_events';
        const fieldName = mappingPayload.fieldName ?? `auto_field_${Date.now()}`;
        const fieldType = mappingPayload.fieldType ?? 'float';

        await this.client.indices.putMapping({
          index: indexName,
          body: {
            properties: {
              [fieldName]: { type: fieldType },
            },
          },
        });
        process.stdout.write(
          `[schema-evolution] mapping applied: index=${indexName} field=${fieldName} type=${fieldType}\n`,
        );
        break;
      }
    }

    await this.store.updateStatus(record.mutationId, 'applied', {
      outcomeNotes: `Applied at ${new Date().toISOString()}`,
    });

    // Write outcome event so the reinforcement loop can observe it
    await indexDocument(this.client, 'experience_events', randomUUID(), {
      event_id: randomUUID(),
      timestamp: new Date().toISOString(),
      event_type: 'schema_evolution',
      session_id: 'system',
      summary: `Schema evolution applied: ${proposal.mutationType} — ${proposal.description}`,
      importance_score: proposal.expectedGain,
      tags: ['schema_evolution', proposal.mutationType],
      mutation_id: proposal.mutationId,
    });
  }
}
