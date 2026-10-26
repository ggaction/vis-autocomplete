import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createRecommendationEngine, applyRecommendation } from '../src/index.js';

// Synthetic data keeps this introduction independent of accounts and corpus downloads.
const rows = [
  { effort: 1, outcome: 2 }, { effort: 2, outcome: 3 },
  { effort: 3, outcome: 2.5 }, { effort: 4, outcome: 5 },
];
const program = chart()
  .createCanvas({ plot: { width: 360, height: 240 }, margin: { left: 70, right: 40, top: 30, bottom: 60 } })
  .createData({ id: 'example', values: rows })
  .createScatterPlot({ id: 'plot', data: 'example',
    x: { field: 'effort', fieldType: 'quantitative' },
    y: { field: 'outcome', fieldType: 'quantitative' } });
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url), 'utf8'));
const engine = createRecommendationEngine(model);
const { recommendations } = engine.recommend(program, { limit: 5 });
if (!recommendations.length) throw new Error('Expected at least one recommendation for the example.');
for (const [index, candidate] of recommendations.entries()) console.log(`${index + 1}. ${candidate.call}`);
const next = applyRecommendation(program, recommendations[0]);
const output = new URL('../output/quickstart/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('before.svg', output), renderToSVG(program));
await writeFile(new URL('after.svg', output), renderToSVG(next));
console.log('Applied the first public action. Open output/quickstart/before.svg and after.svg to compare.');
