import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { profileDataset } from '../src/profile.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';

// CPU work only: no DOM, Canvas, animation, or artificial frame-yield delays.
const count = Number(process.env.ROWS ?? 50000);
const rows = Array.from({ length: count }, (_, i) => ({ X: i % 1000, Y: Math.sin(i) * 30 + i % 137, Group: ['A', 'B', 'C'][i % 3] }));
const model = JSON.parse(await readFile(new URL('../data/initial-model.json', import.meta.url)));
const engine = createInitialChartRecommender(model);
const profile = profileDataset(chart().createData({ id: 'dataset', values: rows }), 'dataset');
const ms = []; let ranked;
for (let run = 0; run < 3; run++) {
  const start = performance.now();
  const result = await engine.recommendAsync(rows, profile, { selection: { fields: ['X', 'Y', 'Group'] }, yieldFrame: async () => {} });
  ms.push(performance.now() - start);
  const output = result.recommendations.map(r => ({ method: r.method, score: r.score, values: r.values }));
  if (ranked) assert.deepEqual(output, ranked); else ranked = output;
}
const report = { rows: count, ms, medianMs: [...ms].sort((a, b) => a - b)[1], ranked };
await mkdir(new URL('../output/loading/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/loading/initial-query.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rows: count, ms, medianMs: report.medianMs, recommendations: ranked.length }));
