import { readFile } from 'node:fs/promises';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const value = JSON.parse(await readFile(new URL(url), 'utf8'));
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(value)};` };
  }
  return nextLoad(url, context);
}
