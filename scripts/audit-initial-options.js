// Regression audit of the real default dataset. This is validation, not
// training data: ranking still uses the full chart corpus and selected fields.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chart } from 'ggaction';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { profileDataset } from '../src/profile.js';
import { selectionData } from '../web/selection-setup.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';

const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
const engine = createInitialChartRecommender(model);
const program = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
const profile = profileDataset(program, 'dataset');
const fields = new Map(profile.fields.map(field => [field.name, field]));
const pairs = [
  ['Miles_per_Gallon', 'Horsepower'], ['Horsepower', 'Miles_per_Gallon'],
  ['Year', 'Miles_per_Gallon'], ['Miles_per_Gallon', 'Year'],
  ['Origin', 'Miles_per_Gallon'], ['Miles_per_Gallon', 'Origin'],
  ['Origin', 'Name'], ['Name', 'Origin'],
];
const results = [];
for (const [x, y] of pairs) for (const color of ['', 'Year', 'Acceleration', 'Origin']) {
  const selection = { x, y, color };
  const selected = selectionData(program, profile, rows, selection);
  const result = engine.recommend(rows, { ...profile, id: selected.data }, { selection });
  const candidates = result.recommendations.map(rec => {
    try {
      const prepared = prepareGuidedAction(selected.program,
        { method: rec.method, args: rec.build(rec.values) }, selected.program, rec.setup(rec.values));
      return { method: rec.method, topLevelActions: prepared.recommendation.validation.topLevelActions };
    } catch (error) { return { method: rec.method, error: error.message }; }
  });
  // Independent minimum-availability contract: an empty candidate list cannot
  // pass this audit just because no native calls failed.
  const expected = fields.get(x).type === 'quantitative' && fields.get(y).type === 'quantitative'
    ? ['createScatterPlot', 'createRegressionPlot', 'createTextPlot', 'createLinePlot', 'createAreaPlot', 'createBarPlot',
      ...(!color || ['quantitative', 'temporal'].includes(fields.get(color).type) ? ['createHeatmap'] : []),
      ...(!color ? ['createHorizonPlot'] : [])] : [];
  const missing = expected.filter(method => !result.recommendations.some(rec => rec.method === method));
  results.push({ selection, candidates, missing, eligibility: result.diagnostics.chartEligibility });
}
mkdirSync(new URL('../output/', import.meta.url), { recursive: true });
writeFileSync(new URL('../output/initial-option-audit.json', import.meta.url), JSON.stringify(results, null, 2));
const failures = results.flatMap(result => result.candidates.filter(candidate => candidate.error)
  .map(candidate => ({ selection: result.selection, ...candidate })));
const missing = results.filter(result => result.missing.length).map(({ selection, missing }) => ({ selection, missing }));
console.log(JSON.stringify({ selections: results.length, candidates: results.reduce((sum, result) => sum + result.candidates.length, 0),
  missing, failures }, null, 2));
if (failures.length || missing.length) process.exitCode = 1;
