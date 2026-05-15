import { OperationalSignal } from '../core-types';

export interface OperationalSourcePlugin {
  sourceType: string;
  loadSignals(options?: any): Promise<OperationalSignal[]>;
  normalize(payload: any): OperationalSignal;
  getMetadata?(): any;
}

export class OperationalPluginRegistry {
  private plugins = new Map<string, OperationalSourcePlugin>();

  register(plugin: OperationalSourcePlugin) {
    this.plugins.set(plugin.sourceType, plugin);
  }

  async loadFromSource(sourceType: string, options?: any): Promise<OperationalSignal[]> {
    const plugin = this.plugins.get(sourceType);
    if (!plugin) throw new Error(`No plugin registered for ${sourceType}`);
    return plugin.loadSignals(options);
  }

  getRegisteredSources(): string[] {
    return Array.from(this.plugins.keys());
  }
}

export const operationalRegistry = new OperationalPluginRegistry();