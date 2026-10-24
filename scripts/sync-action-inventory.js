import { readFile, writeFile } from 'node:fs/promises';

export async function syncActionInventory() {
  const declarations = await readFile(new URL('../vendor/ggaction/types/program.d.ts', import.meta.url), 'utf8');
  const methods = [...new Set([...declarations.split('export class ChartProgram {')[1].matchAll(/^  ([A-Za-z]\w*)(?:<[^\n]+>)?\(/gm)]
    .map(match => match[1]))].filter(name => !['constructor', 'editSemantic', 'createGraphics', 'editGraphics', 'createDerivedData'].includes(name)).sort();
  const source = `// Generated from ggaction's public ChartProgram declarations by catalog:check.\nexport const PUBLIC_ACTION_NAMES = Object.freeze(${JSON.stringify(methods, null, 2)});\n`;
  await writeFile(new URL('../src/public-actions.js', import.meta.url), source);
  return methods;
}
