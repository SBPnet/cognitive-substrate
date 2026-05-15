import { OperationalPluginRegistry, operationalRegistry } from '@cognitive-substrate/core-types';
import { OperationalSignal } from '@cognitive-substrate/core-types';

// Example: Zendesk Plugin
class ZendeskPlugin implements OperationalPluginRegistry {
  sourceType = 'zendesk';

  async loadSignals(options: { ticketLimit?: number } = {}) {
    // In real impl: call Zendesk API
    console.log('ZendeskPlugin: loading signals...');
    return [];
  }

  normalize(payload: any): OperationalSignal {
    // mapping logic
    return {} as OperationalSignal;
  }
}

// Similar for Slack, Aiven, etc.

export function registerCoreOperationalPlugins() {
  operationalRegistry.register(new ZendeskPlugin());
  // operationalRegistry.register(new SlackPlugin());
  // etc.
}
