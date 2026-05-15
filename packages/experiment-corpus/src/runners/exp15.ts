import { generateAllOperationalData } from '../generators/operational';
import { saveCorpusBatch } from '../utils';
import { registerCoreOperationalPlugins, operationalRegistry } from '@cognitive-substrate/core-types';

export async function runExp15() {
  console.log('🚀 Running Experiment 15 with Plugin Architecture...');

  // Register plugins
  registerCoreOperationalPlugins();
  console.log('Registered sources:', operationalRegistry.getRegisteredSources());

  const signals = generateAllOperationalData();

  await saveCorpusBatch('operational', signals);

  console.log(`✅ Saved ${signals.length} operational signals`);
  console.log('Plugin-ready dataset generated!');

  return signals;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExp15().catch(console.error);
}