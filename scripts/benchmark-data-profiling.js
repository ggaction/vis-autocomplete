// Measures actual data profiling and ranking; excludes DOM, paint, and worker IPC.
// Run before/after revisions in otherwise idle processes. Output fingerprints
// make a faster but semantically different recommendation result visible.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chart } from 'ggaction';
import { profileDataset } from '../src/profile.js';
import { describeDataset } from '../src/dataset-profile.js';
import { createRecommendationEngine } from '../src/engine.js';

const count = Number(process.env.BENCH_ROWS ?? 5000);
const trials = Number(process.env.BENCH_TRIALS ?? 4);
if (!Number.isInteger(count) || count < 2 || !Number.isInteger(trials) || trials < 1) {
  throw new Error('BENCH_ROWS and BENCH_TRIALS must be positive integers (at least two rows).');
}
const rows = Array.from({ length: count }, (_, i) => Object.fromEntries([
  ['category', `Group ${i % 8}`],
  ...Array.from({ length: 12 }, (_, j) => [`field${j}`, (i * (j + 1) % 1223) + (i % 7) / 10]),
]));
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const base = chart().createCanvas({ width: 700, height: 450, margin: 70 })
  .createData({ id: 'd', values: rows })
  .createScatterPlot({ id: 'p', data: 'd', x: 'field0', y: 'field1', color: 'category' });
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const measure = run => {
  const start = performance.now(), result = run();
  return { ms: performance.now() - start, result };
};
const samples = [], fingerprints = {};
for (let trial = 0; trial < trials; trial++) {
  const profile = measure(() => profileDataset(base, 'd'));
  const statistics = measure(() => describeDataset(rows));
  const ranking = measure(() => engine.rank(base, { target: 'p', group: 'encoding', limit: 999,
    includeRevisions: true, deprioritizeAppliedActions: true }));
  samples.push({ trial, profileMs: profile.ms, statisticsMs: statistics.ms, rankingMs: ranking.ms });
  const hashes = { profile: fingerprint(profile.result), statistics: fingerprint(statistics.result),
    recommendations: fingerprint(ranking.result.recommendations), ranking: fingerprint(ranking.result) };
  if (trial && Object.keys(hashes).some(key => hashes[key] !== fingerprints[key])) throw new Error('Repeated requests changed their output.');
  Object.assign(fingerprints, hashes);
}
let current = base;
const history = [];
for (let step = 0; step <= 80; step++) {
  if (step) current = current.encodeOpacity({ target: 'p', value: step % 2 ? 0.4 : 0.7 });
  if (step % 20) continue;
  const profile = measure(() => profileDataset(current, 'd'));
  const ranking = measure(() => engine.rank(current, { target: 'p', group: 'encoding', limit: 999,
    includeRevisions: true, deprioritizeAppliedActions: true }));
  history.push({ step, profileMs: profile.ms, rankingMs: ranking.ms, recommendations: ranking.result.recommendations.length,
    recommendationsFingerprint: fingerprint(ranking.result.recommendations), fingerprint: fingerprint(ranking.result) });
}
console.log(JSON.stringify({ runtime: process.version, rows: count, fields: 13, trials,
  scope: 'Immutable native data profiles, exact statistical features, deferred Encoding ranking, and 80 native opacity edits. Chart construction/edit execution and output hashing are outside measured timings; no DOM/paint/IPC.',
  samples, fingerprints, history }, null, 2));
