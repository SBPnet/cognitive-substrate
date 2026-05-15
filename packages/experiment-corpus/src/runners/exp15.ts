cat > packages/experiment-corpus/src/runners/exp15.ts << 'EOF'
import { generateAllOperationalData } from '../generators/operational';
import { saveCorpusBatch } from '../utils';
import { OperationalPluginRegistry } from '@cognitive-substrate/core-types/operational-plugin';
import { ZendeskPlugin } from '@cognitive-substrate/core-types/plugins/zendesk';

/**
 * Experiment 15 — Cross-Domain Operational Correlation with Plugin Architecture
 */
export async function runExp15() {
  console.log('🚀 Running Experiment 15 with Plugin Architecture...');

  // Register plugins
  const registry = new OperationalPluginRegistry();
  registry.register(new ZendeskPlugin());
  // registry.register(new SlackPlugin());     // ← add more here later
  // registry.register(new AivenPlugin());

  console.log(`Registered sources: ${registry.getRegisteredSources()}`);

  // Generate data (plugins can be used here in future for real ingestion)
  const signals = generateAllOperationalData();

  await saveCorpusBatch('operational', signals);

  console.log(`✅ Saved ${signals.length} operational signals to experiment-corpus/data/operational/`);
  console.log('   Time windows: normal → degraded → outage → recovery');
  console.log('   Plugin architecture ready for real sources!');

  return signals;
}

// ESM-compatible entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runExp15().catch(console.error);
}
EOF