import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Optional module path permits comparison with an unchanged historical copy.
// No server, credentials, uploaded data or production storage is used.
const modulePath = process.argv[2] ?? 'web/cloud/documents.js';
const { changesBetween, sameDocument } = await import(pathToFileURL(resolve(modulePath)));
function apply(before, changes) {
  let value = structuredClone(before);
  for (const change of changes) {
    if (!change.path.length && change.op === 'set') { value = structuredClone(change.value); continue; }
    const parent = change.path.slice(0, -1).reduce((at, key) => at[key], value), key = change.path.at(-1);
    if (change.op === 'splice') (change.path.length ? parent[key] : value).splice(change.index, change.deleteCount, ...structuredClone(change.values));
    else if (change.op === 'remove') delete parent[key];
    else Object.defineProperty(parent, key, { value: structuredClone(change.value), writable: true, enumerable: true, configurable: true });
  }
  return value;
}
const measure = run => {
  const samples = [];
  let value;
  for (let i = 0; i < 9; i++) {
    const start = performance.now(); value = run();
    if (i > 1) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { p50: samples[Math.floor(samples.length / 2)], p95: samples.at(-1), value };
};

const results = [];
for (const count of [50, 150, 400]) {
  const calls = Array.from({ length: count + 1 }, (_, i) => ({ method: 'editTitle', args: {
    text: `Chart title ${i}`, subtitle: 'Benchmark', titleStyle: { fontSize: 23 + i % 5, fontFamily: 'Arial' },
  } }));
  const entries = Array.from({ length: count }, (_, i) => ({ calls: calls.slice(0, i + 1), steps: i, currentNote: 'Edit title' }));
  const before = { datasets: [{ session: { entries, index: count - 1 } }] };
  const after = { datasets: [{ session: { entries: [...entries, { calls, steps: count, currentNote: 'Edit title' }], index: count } }] };
  // IndexedDB cloning preserves shared calls but not cross-revision identities.
  const stored = structuredClone(before), saved = structuredClone(after), json = JSON.stringify(after);
  const diff = measure(() => changesBetween(stored, after));
  const compare = measure(() => sameDocument ? sameDocument(saved, after) : json === JSON.stringify(after));
  if (!compare.value) throw new Error('Identical saved snapshots must compare equal.');
  const exactReplay = isDeepStrictEqual(apply(stored, diff.value), after);
  if (!exactReplay) throw new Error('The structural delta did not reconstruct the complete submitted project.');
  results.push({ historyEntries: count, snapshotBytes: Buffer.byteLength(json),
    delta: { p50Ms: diff.p50, p95Ms: diff.p95, bytes: Buffer.byteLength(JSON.stringify(diff.value)) },
    duplicateComparison: { p50Ms: compare.p50, p95Ms: compare.p95 }, exactReplay });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), modulePath,
  moduleSha256: createHash('sha256').update(readFileSync(resolve(modulePath))).digest('hex'), results }, null, 2));
