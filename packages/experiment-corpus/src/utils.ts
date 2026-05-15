import fs from 'fs/promises';
import path from 'path';

export async function saveCorpusBatch(name: string, data: any[]) {
  // Correct path: always relative to the monorepo root
  const monorepoRoot = path.resolve(process.cwd(), '..', '..'); // go up from package
  const dir = path.join(monorepoRoot, 'packages/experiment-corpus/data', name);
  
  await fs.mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${name}-batch-${timestamp}.json`);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`💾 Saved batch to ${filePath}`);
  return filePath;
}
