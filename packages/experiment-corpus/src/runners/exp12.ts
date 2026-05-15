import { generateAllOperationalData } from '../generators/operational';
import { saveCorpusBatch } from '../utils';

/**
 * Exp 12 runner — generates and saves operational correlation dataset.
 */
export async function runExp12() {
  console.log('Generating operational signals for Exp 12...');
  const signals = generateAllOperationalData();
  
  await saveCorpusBatch('operational', signals);
  console.log(`✅ Saved ${signals.length} operational signals to experiment-corpus/data/operational/`);
  
  return signals;
}

if (require.main === module) {
  runExp12().catch(console.error);
}
