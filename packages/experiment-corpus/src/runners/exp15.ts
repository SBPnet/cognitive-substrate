import { generateAllOperationalData } from '../generators/operational';
import { saveCorpusBatch } from '../utils';

/**
 * Experiment 15 — Cross-Domain Operational Correlation (Full Stack Exercise)
 * Generates synthetic dataset with DB metrics, Zendesk tickets, and Slack threads.
 * Plugin-ready design for future operational sources.
 */
export async function runExp15() {
  console.log('🚀 Generating operational signals for Experiment 15...');

  const signals = generateAllOperationalData();

  await saveCorpusBatch('operational', signals);

  console.log(`✅ Saved ${signals.length} operational signals to experiment-corpus/data/operational/`);
  console.log('   Windows: normal → degraded → outage → recovery with cross-source correlations');

  return signals;
}

// Run directly if called as main module
if (require.main === module) {
  runExp15().catch(console.error);
}