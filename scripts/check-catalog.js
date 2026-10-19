import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ggactionSource } from './ggaction-source.js';
import { chart } from 'ggaction';
import { describeAction } from 'ggaction/inspection';
import { syncActionInventory } from './sync-action-inventory.js';
import { INITIAL_PLOT_METHODS } from '../src/plot-catalog.js';
import assert from 'node:assert/strict';

const runtimeEntry = import.meta.resolve('ggaction');
const pkg = JSON.parse(await readFile(new URL('../package.json', runtimeEntry), 'utf8'));
const declarations = await readFile(new URL('../types/program.d.ts', runtimeEntry), 'utf8');
const program = chart();
await syncActionInventory();
const { ACTION_METHODS } = await import('../src/catalog.js');
const { corpusActionPolicy } = await import('../src/action-capabilities.js');
const methods = [...new Set([...ACTION_METHODS, ...INITIAL_PLOT_METHODS])].map(method => {
  assert.equal(typeof program[method], 'function', `${method} is missing from the installed ggaction`);
  assert.ok(new RegExp(`\\b${method}(?:<[^\\n]+>)?\\(`).test(declarations), `${method} is not a declared public method`);
  const descriptor = describeAction(program, { action: method });
  assert.ok(['supported', 'needs-input'].includes(descriptor.applicability), `${method} has no supported public descriptor`);
  return { method, runtime: true, publicTypeDeclaration: true, inspectionDescriptor: true };
});
let corpus;
try { corpus = JSON.parse(await readFile(new URL('../data/corpus-report.json', import.meta.url))); } catch {}
const report = { ggactionVersion: pkg.version, ggactionSource: ggactionSource(), policy: 'one-existing-public-ggaction-method-per-recommendation',
  inventorySource: 'public-TypeScript-declarations-runtime-and-inspection',
  corpusActions: Object.entries(corpus?.actionFrequency ?? {}).map(([method, charts]) => ({ method, charts,
    ...corpusActionPolicy(method), runtime: typeof program[method] === 'function' })),
  customActionsRegistered: 0, methods };
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/action-catalog.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Verified ${methods.length} public ggaction ${pkg.version} methods. Custom actions: 0.`);
