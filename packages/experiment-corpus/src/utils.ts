import fs from 'fs/promises';
import path from 'path';

export async function saveCorpusBatch(name: string, data: any[]) {
  const dir = path.join(process.cwd(), 'packages/experiment-corpus/data', name);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${name}-batch.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));

  console.log(`Saved batch to ${filePath}`);
  return filePath;
}
