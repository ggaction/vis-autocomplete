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
  assert.deepEqual(editor.controls.map(c => c.key), ['axis', 'statistic']);
  assert.deepEqual(editor.controls[1].choices.map(c => c.value), ['mean', 'median', 'min', 'max', 'middle50', 'middle95']);
  const action = buildRecommendationCall({ ...editor, method: rec.method }, valuesFor(editor.controls));
  assert.equal(action.method, 'createStatisticalReference');
  assert.equal(action.args.stroke, '#222222');
  assert.equal(action.args.strokeWidth, 2.5);
  assert.equal(action.args.strokeDash, 'solid');
  const implicit = recommendationParameters({ ...rec, args: { source: 'plot', axis: 'x' } }, profileDataset(p, 'data'));
  assert.equal(valuesFor(implicit.controls).statistic, 'mean', 'the editor must honor the native omitted-statistic default');
  const q = prepareGuidedAction(p, action).authoringPreview;
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
    assert.equal(q.trace.children.length, p.trace.children.length + 1);
    assert.equal(q.trace.children.at(-1).op, action.method);
    const dataset = q.semanticSpec.datasets.find(d => d.id.endsWith('-statistical-reference-data'));
    const actual = Object.values(dataset.values[0]);
    assert.equal(actual.length, endpoints.length);
    actual.forEach((value, i) => assert.ok(Math.abs(value - endpoints[i] * (axis === 'x' ? 1 : 2)) < 1e-10));
    const applied = addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation), prepared.guideCall);
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
