import { replayPrepared, assertPreparedTrace } from './support/prepared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createRecommendationEngine, applyRecommendation } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { prepareGuidedAction, addDefaultGuides, defaultCanvasOptions } from '../src/prepare.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';
import { createCalculationService } from '../web/calculation-service.js';

const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values:
  [0, 10, 20, 30, 40].map(X => ({ X, Y: X * 2 })) }).createScatterPlot({ id: 'plot', x: 'X', y: 'Y' });
const options = { target: 'plot', group: 'transform', limit: 100 };
const referenceCard = p => {
  const recommendations = engine.recommend(addDefaultGuides(p), options).recommendations;
  const cards = recommendations.filter(r => r.method === 'createStatisticalReference');
  assert.equal(cards.length, 1, 'line and interval choices must occupy one card');
  return cards[0];
};

test('one statistical card defaults to a dark thick solid line and preserves real native alternatives', () => {
  const p = base(), rec = referenceCard(p), editor = recommendationParameters(rec, profileDataset(p, 'data'));
  assert.equal(rec.label, 'Add statistic');
  assert.deepEqual([...new Set(rec.alternatives.map(a => a.method))], ['createStatisticalReference']);
  assert.deepEqual(editor.controls.map(c => c.key), ['axis', 'statistic', 'population', 'groupBy']);
  assert.deepEqual(editor.controls[1].choices.map(c => c.value), ['mean', 'median', 'min', 'max', 'middle50', 'middle95']);
  const action = buildRecommendationCall({ ...editor, method: rec.method }, valuesFor(editor.controls));
  assert.equal(action.method, 'createStatisticalReference');
  assert.equal(action.args.stroke, undefined, 'leave color selection to the native default');
  assert.equal(action.args.strokeWidth, 2.5);
  assert.equal(action.args.strokeDash, 'solid');
  const implicit = recommendationParameters({ ...rec, args: { source: 'plot', axis: 'x' } }, profileDataset(p, 'data'));
  assert.equal(valuesFor(implicit.controls).statistic, 'mean', 'the editor must honor the native omitted-statistic default');
  const q = prepareGuidedAction(p, action).authoringPreview;
  assert.equal(q.graphicSpec.objects.statisticalReference.items[0].properties.stroke, '#222222');
  assert.equal(q.graphicSpec.objects.statisticalReference.items[0].properties.strokeWidth, 2.5);
});

test('all statistics and central intervals preview and Apply as exactly one native call on either axis', () => {
  const p = base(), before = JSON.stringify(p), rec = referenceCard(p);
  const editor = recommendationParameters(rec, profileDataset(p, 'data'));
  const expected = { mean: [20], median: [20], min: [0], max: [40], middle50: [10, 30], middle95: [1, 39] };
  for (const axis of ['x', 'y']) for (const [statistic, endpoints] of Object.entries(expected)) {
    const action = buildRecommendationCall({ ...editor, method: rec.method }, { axis, statistic });
    assert.equal(action.method, 'createStatisticalReference');
    const prepared = prepareGuidedAction(p, action), q = prepared.authoringPreview;
    assertPreparedTrace(prepared);
    const dataset = q.semanticSpec.datasets.find(d => d.id.endsWith('-statistical-reference-data'));
    const actual = Object.values(dataset.values[0]);
    assert.equal(actual.length, endpoints.length);
    actual.forEach((value, i) => assert.ok(Math.abs(value - endpoints[i] * (axis === 'x' ? 1 : 2)) < 1e-10));
    const applied = replayPrepared(prepared);
    assert.deepEqual(applied.graphicSpec, prepared.preview.graphicSpec);
    if (statistic === 'middle95') assert.deepEqual(action.args.statistics, [{ op: 'quantile', p: .025 }, { op: 'quantile', p: .975 }]);
  }
  assert.equal(JSON.stringify(p), before);
});

test('worker defaults use the native facade and an applied statistical action does not repeat', () => {
  const p = base(), service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p), guideCall: { method: 'createGuides', args: {} } });
  const request = page => service.execute({ type: 'recommend', stateId: 1, options, group: 'transform', page });
  let response = request(0);
  for (let page = 1; page < response.pagination.pageCount; page++) response = request(page);
  const cards = response.result.recommendations.filter(r => r.method === 'createStatisticalReference');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].method, 'createStatisticalReference');
  const editor = recommendationParameters(cards[0], response.profile);
  const action = buildRecommendationCall({ ...editor, method: cards[0].method }, { axis: 'y', statistic: 'middle95' });
  const preview = service.execute({ type: 'prepare', stateId: 1, action });
  assert.equal(preview.recommendation.method, 'createStatisticalReference');
  assert.equal(preview.recommendation.validation.topLevelActions, 1);
  const applied = prepareGuidedAction(p, action).authoringPreview;
  const next = engine.recommend(addDefaultGuides(applied), options).recommendations;
  assert.ok(!next.some(r => r.method === 'createStatisticalReference'), 'an applied statistical action must not repeat');
});

test('Group by is available on both axes with or without a color mapping, including central intervals', () => {
  const rows = [{ X: 1, Y: 2, Origin: 'USA' }, { X: 3, Y: 6, Origin: 'USA' },
    { X: 6, Y: 12, Origin: 'Europe' }, { X: 10, Y: 20, Origin: 'Europe' },
    { X: 20, Y: 40, Origin: 'Japan' }, { X: 30, Y: 60, Origin: 'Japan' }];
  for (const color of [undefined, 'Origin']) {
    const p = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows })
      .createScatterPlot({ id: 'plot', x: 'X', y: 'Y', ...(color ? { color } : {}) });
    const service = createCalculationService(model);
    service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
    const response = service.execute({ type: 'recommend', stateId: 1, options, group: 'transform', searchQuery: 'statistics' });
    const rec = response.result.recommendations.find(r => r.method === 'createStatisticalReference');
    const editor = recommendationParameters(rec, response.profile);
    assert.equal(editor.controls.length, 4);
    assert.ok(editor.controls.find(c => c.key === 'groupBy').choices.some(c => c.value === 'Origin'));
    for (const axis of ['x', 'y']) for (const statistic of ['mean', 'middle95']) {
      const values = editor.normalizeValues({ ...valuesFor(editor.controls), axis, statistic, groupBy: 'Origin' }, 'groupBy');
      const action = buildRecommendationCall({ ...editor, method: rec.method }, values);
      assert.equal(action.args.groupBy, 'Origin');
      const result = prepareGuidedAction(p, action);
      const config = result.authoringPreview.markConfigs.statisticalReference.statisticalReference;
      const data = result.authoringPreview.semanticSpec.datasets.find(d => d.id === config.dataId).values;
      assert.deepEqual(data.map(row => row.group), ['USA', 'Europe', 'Japan']);
      if (statistic === 'mean') assert.deepEqual(data.map(row => row.value), [2, 8, 25].map(v => v * (axis === 'x' ? 1 : 2)));
      assert.equal(result.authoringPreview.graphicSpec.objects.statisticalReference.items.length, 3);
      if (statistic === 'mean') {
        const expected = color ? [0, 2, 4].map(index => p.graphicSpec.objects.plot.items[index].properties.fill)
          : Array(3).fill('#222222');
        assert.deepEqual(result.authoringPreview.graphicSpec.objects.statisticalReference.items.map(item => item.properties.stroke), expected);
      }
      assert.equal(service.execute({ type: 'prepare', stateId: 1, action }).recommendation.validation.topLevelActions, 1);
    }
    assert.ok(!('groupBy' in editor.build({ ...valuesFor(editor.controls), groupBy: '' })));
  }
});

test('grouping an aggregate uses bound rows when the chosen field splits a visible item', () => {
  const p = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: [
    { X: 'A', Y: 2, Origin: 'USA' }, { X: 'A', Y: 4, Origin: 'Europe' },
    { X: 'B', Y: 6, Origin: 'USA' }, { X: 'B', Y: 8, Origin: 'Europe' },
  ] }).createBarPlot({ id: 'plot', x: 'X', y: { field: 'Y', aggregate: 'mean' } });
  const rec = referenceCard(p), editor = recommendationParameters(rec, profileDataset(p, 'data'));
  const values = editor.normalizeValues({ ...valuesFor(editor.controls), groupBy: 'Origin' }, 'groupBy');
  assert.equal(values.population, 'boundData');
  assert.equal(editor.resolveControls(values).find(c => c.key === 'population').choices[0].disabled, true);
  const result = prepareGuidedAction(p, buildRecommendationCall({ ...editor, method: rec.method }, values));
  assert.equal(result.authoringPreview.graphicSpec.objects.statisticalReference.items.length, 2);
});
