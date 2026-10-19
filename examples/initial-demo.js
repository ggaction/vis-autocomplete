import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chart } from 'ggaction';
import { createInitialChartRecommender, profileDataset } from '../src/index.js';
import { prepareGuidedAction } from '../web/plot-setup.js';

const root = new URL('../', import.meta.url);
const model = JSON.parse(await readFile(new URL('data/initial-model.json', root), 'utf8'));
const engine = createInitialChartRecommender(model);
const cars = JSON.parse(await readFile(new URL('web/data/cars.json', root), 'utf8'));
const sales = Array.from({ length: 36 }, (_, i) => ({
  Month: `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
  Sales: Math.round(100 + i * 3 + Math.sin(i / 2) * 24), Cost: Math.round(55 + i * 1.5 + Math.cos(i / 3) * 10),
  Orders: 30 + i * 2, Region: ['North', 'South', 'West'][i % 3],
}));
const output = { method: model.method, provenance: model.provenance, scenarios: [] };
for (const [name, rows] of [['Cars', cars], ['Monthly sales', sales]]) {
  const p = chart().createCanvas({ width: 700, height: 430, margin: { left: 80, right: 125, top: 42, bottom: 74 } })
    .createData({ id: 'dataset', values: rows });
  const result = engine.recommend(rows, profileDataset(p, 'dataset'));
  const recommendations = [], unavailable = [];
  for (const rec of result.recommendations) {
    if (rec.requirement) { unavailable.push({ method: rec.method, reason: rec.requirement }); continue; }
    let prepared, parameterSource = 'neighbor-roles';
    try { prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(rec.values) }); }
    catch (error) {
      try { prepared = prepareGuidedAction(p, { method: rec.method, args: rec.build(rec.fallbackValues) }); parameterSource = 'compatible-default'; }
      catch (fallback) { unavailable.push({ method: rec.method, reason: fallback.message }); continue; }
    }
    recommendations.push({ method: rec.method, args: prepared.recommendation.args, score: rec.score,
      parameterSource, parameterEvidence: rec.parameterEvidence, evidence: rec.evidence });
    if (recommendations.length === 5) break;
  }
  console.log(name);
  for (const [index, rec] of recommendations.entries()) console.log(`  ${index + 1}. ${rec.score.toFixed(6)} program.${rec.method}(${JSON.stringify(rec.args)})`);
  output.scenarios.push({ name, originalRows: rows.length, neighbors: result.neighbors, recommendations, unavailable });
}
await mkdir(new URL('output/', root), { recursive: true });
await writeFile(new URL('output/initial-demo.json', root), JSON.stringify(output, null, 2) + '\n');
console.log('Full neighbor contributions: output/initial-demo.json');
