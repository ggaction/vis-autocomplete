import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { addDefaultGuides, defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { chartOwner } from '../src/chart-owner.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';

const engine = createRecommendationEngine(JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url))));
const rows = [
  { category: 'A', value: 1, before: 10, cohort: 'P', time: 0 },
  { category: 'A', value: 3, before: 30, cohort: 'Q', time: 1 },
  { category: 'A', value: 8, before: 80, cohort: 'P', time: 3 },
  { category: 'B', value: 20, before: 200, cohort: 'Q', time: 8 }
];
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const card = program => engine.recommend(addDefaultGuides(program), {
  target: 'plot', group: 'transform', searchQuery: 'statistics', limit: 100
}).recommendations.find(rec => rec.method === 'createStatisticalReference');

test('endpoint source group controls normalize unavailable visible-item fields to bound observations', () => {
  for (const method of ['createDotPlot', 'createLollipopPlot', 'createDumbbellPlot']) {
    const p = base()[method]({ id: 'plot', category: 'category', orientation: 'vertical',
      summary: 'mean',
      ...(method === 'createDumbbellPlot' ? { start: 'before', end: 'value' } : { value: 'value' }) });
    const rec = card(p);
    assert.ok(rec);
    const editor = recommendationParameters(rec, profileDataset(p, 'data'));
    const values = editor.normalizeValues({ ...valuesFor(editor.controls), axis: 'y',
      population: 'visibleItems', groupBy: 'cohort' }, 'groupBy');
    assert.equal(values.population, 'boundData');
    assert.equal(editor.resolveControls(values).find(control => control.key === 'population').choices[0].disabled, true);
    const q = prepareGuidedAction(p, buildRecommendationCall({ ...editor, method: rec.method }, values)).authoringPreview;
    const config = q.markConfigs.statisticalReference.statisticalReference;
    assert.deepEqual(q.semanticSpec.datasets.find(data => data.id === config.dataId).values,
      [{ group: 'P', value: 4.5 }, { group: 'Q', value: 11.5 }]);
    if (method === 'createDumbbellPlot') {
      assert.equal(chartOwner(p, p.semanticSpec.layers.find(layer => layer.id === 'plotStart')).target, 'plot');
    }
  }
});

test('Horizon statistics keep quantitative X and explain the unavailable folded Y axis', () => {
  const p = base().createHorizonPlot({ id: 'plot', x: 'time', y: 'value', guides: false });
  const rec = card(p);
  assert.ok(rec);
  const editor = recommendationParameters(rec, profileDataset(p, 'data'));
  const axes = editor.controls.find(control => control.key === 'axis').choices;
  assert.equal(axes.find(choice => choice.value === 'x').disabled, false);
  assert.equal(axes.find(choice => choice.value === 'y').disabled, true);
  assert.match(axes.find(choice => choice.value === 'y').reason, /folded band coordinate/);
  const values = editor.normalizeValues({ ...valuesFor(editor.controls), axis: 'y', groupBy: 'cohort' }, 'axis');
  assert.equal(values.axis, 'x');
  const q = prepareGuidedAction(p, buildRecommendationCall({ ...editor, method: rec.method }, values)).authoringPreview;
  const config = q.markConfigs.statisticalReference.statisticalReference;
  assert.deepEqual(q.semanticSpec.datasets.find(data => data.id === config.dataId).values,
    [{ group: 'P', value: 1.5 }, { group: 'Q', value: 4.5 }]);
});
