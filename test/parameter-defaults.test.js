import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { parameterEvidenceCollector } from '../scripts/parameter-evidence.js';
import { parameterSettings } from '../src/parameter-defaults.js';
import { applyParameterDefaults } from '../src/control-defaults.js';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { createCalculationService } from '../web/calculation-service.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { addDefaultGuides, defaultCanvasOptions } from '../web/plot-setup.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'cars', values: rows })
  .createScatterPlot({ id: 'plot', x: 'Weight_in_lbs', y: 'Acceleration', guides: false, missing: 'skip' });
const parsed = (...options) => ({ calls: options.map(options => ({ method: 'encodeOpacity', options })) });

test('each chart splits one vote across distinct explicit settings, independent of stage repetition', () => {
  const collector = parameterEvidenceCollector();
  for (let stage = 0; stage < 8; stage++) collector.add('a', parsed({ value: .7 }, { value: .7 }, { value: 1 }));
  collector.add('b', parsed({ value: 1 }));
  collector.add('c', parsed({ field: 'private-field', target: 'private-id' }));
  const result = collector.finish({ chartCount: 3 });
  const values = result.methods.encodeOpacity.settings.value;
  assert.equal(values.charts, 2);
  assert.deepEqual(values.values, [{ value: 1, charts: 2, weight: 1.5 }, { value: .7, charts: 1, weight: .5 }]);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(result.methods.encodeOpacity.charts, 3);
  collector.add('d', parsed({ value: .7 }));
  assert.equal(collector.finish({}).methods.encodeOpacity.settings.value.charts, 3);
});

test('unknown/dynamic options are not votes for missing library defaults; field names never transfer', () => {
  assert.deepEqual(parameterSettings('encodeOpacity', { field: Symbol('unknown'), value: Symbol('unknown') }), {});
  assert.deepEqual(parameterSettings('createLinePlot', { id: 'secret', x: 'private', y: { field: 'private', aggregate: 'mean' },
    data: [{ value: 99 }], line: { strokeWidth: 2 } }), { 'y.aggregate': 'mean', 'line.strokeWidth': 2 });
});

test('create/edit counterpart evidence pools once per chart, radius never aliases incompatible area units', () => {
  const c = parameterEvidenceCollector();
  c.add('a', { calls: [{ method: 'createPointMark', options: { opacity: .7 } },
    { method: 'editPointMark', options: { opacity: .7 } }, { method: 'encodePointRadius', options: { value: 4 } }] });
  const evidence = c.finish({});
  assert.equal(evidence.methods.editPointMark.settings.opacity.charts, 1);
  assert.equal(evidence.methods.encodeSize, undefined);
});

test('control defaults use the most frequent allowed native setting and preserve fallback with sparse evidence', () => {
  const evidence = { settings: { 'style.opacity': { charts: 10, values: [
    { value: 2, charts: 6, weight: 6 }, { value: .85, charts: 4, weight: 4 }] },
    'style.strokeWidth': { charts: 2, values: [{ value: 4, charts: 2, weight: 2 }] } } };
  const controls = [{ key: 'alpha', type: 'number', value: .5, min: 0, max: 1, step: .05 },
    { key: 'width', type: 'number', value: 2, min: 0, max: 5, step: .5 }];
  const build = v => ({ style: { opacity: v.alpha, strokeWidth: v.width } });
  const decisions = applyParameterDefaults(controls, build, { method: 'editPointMark', defaultEvidence: evidence });
  assert.deepEqual(valuesFor(controls), { alpha: .85, width: 2 });
  assert.equal(decisions[0].observedCharts, 10);
  // A later user choice always wins; building it does not run default inference.
  assert.equal(build({ ...valuesFor(controls), alpha: .2 }).style.opacity, .2);
});

test('popular continuous scale types cannot leak into categorical/temporal axis defaults', () => {
  const evidence = { settings: { 'scale.type': { charts: 10, values: [{ value: 'linear', charts: 10, weight: 10 }] } } };
  for (const fieldType of ['nominal', 'ordinal', 'temporal']) {
    const controls = [{ key: 'scale', type: 'select', value: 'auto', choices: ['auto', 'linear', 'log'].map(value => ({ value })) }];
    applyParameterDefaults(controls, v => ({ field: 'local', fieldType,
      ...(v.scale === 'auto' ? {} : { scale: { type: v.scale } }) }), { method: 'encodeX', defaultEvidence: evidence });
    assert.equal(controls[0].value, 'auto', fieldType);
  }
});

test('initial plot controls share the learned default policy while preserving selected fields and ranking', () => {
  const initial = JSON.parse(readFileSync(new URL('../data/initial-model.json', import.meta.url)));
  const original = createInitialChartRecommender(initial);
  const profile = profileDataset(base(), 'cars');
  const selection = { x: 'Weight_in_lbs', y: 'Acceleration', color: '' };
  const before = original.recommend(rows, profile, { selection });
  initial.parameterDefaults.methods.createLinePlot = { settings: { 'y.aggregate': { charts: 5,
    values: [{ value: 'median', charts: 5, weight: 5 }] } } };
  const after = createInitialChartRecommender(initial).recommend(rows, profile, { selection });
  assert.deepEqual(before.recommendations.map(r => [r.method, r.score]), after.recommendations.map(r => [r.method, r.score]));
  const line = after.recommendations.find(r => r.method === 'createLinePlot');
  assert.equal(line.values.aggregate, 'median');
  assert.equal(line.build(line.values).x.field, selection.x);
  assert.equal(line.build(line.values).y.field, selection.y);
  assert.equal(line.defaultDecisions[0].source, 'corpus');
});

test('stroke starts Fixed and black even when corpus supports variable/color; both modes stay editable', () => {
  const raw = base(), view = addDefaultGuides(raw);
  const rec = createRecommendationEngine(model).rank(view, { target: 'plot', includeRevisions: true, group: 'encoding', limit: 100 })
    .recommendations.find(r => r.method === 'encodeStroke');
  assert.equal(rec.args.value, '#000000');
  const editor = recommendationParameters(rec, profileDataset(view, 'cars'));
  const defaults = valuesFor(editor.controls);
  assert.equal(defaults.mode, 'fixed');
  assert.equal(defaults.value, '#000000');
  assert.equal(editor.defaultDecisions.find(d => d.control === 'mode').source, 'project-preference');
  assert.ok(editor.build({ ...defaults, mode: 'variable' }).field);
});

test('default evidence changes parameters without changing paper scores or ranked action IDs', () => {
  const raw = addDefaultGuides(base());
  const legacy = structuredClone(model); delete legacy.parameterDefaults;
  const options = { target: 'plot', group: 'encoding', includeRevisions: true, limit: 100 };
  const summary = result => result.recommendations.map(r => [r.id, r.score]);
  assert.deepEqual(summary(createRecommendationEngine(model).rank(raw, options)), summary(createRecommendationEngine(legacy).rank(raw, options)));
});

test('worker resolves defaults once, keeps applied stroke discoverable, and reopens the exact validated controls', () => {
  const raw = base().encodeStroke({ target: 'plot', value: '#000000' });
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 'test', snapshot: serializeProgram(raw) });
  const result = service.execute({ type: 'recommend', stateId: 'test', group: 'encoding', searchQuery: 'stroke color',
    options: { target: 'plot', includeRevisions: true, deprioritizeAppliedActions: true, limit: 100 } });
  const rec = result.result.recommendations.find(r => r.method === 'encodeStroke');
  assert.ok(rec, 'an already-black stroke must fall back to an editable neighbor, not disappear');
  const editor = recommendationParameters(rec, result.profile);
  assert.deepEqual(editor.build(valuesFor(editor.controls)), rec.args);
  assert.equal(rec.previouslyApplied, true);
});

test('shipped corpus learns opacity and width defaults in the actual native worker path', () => {
  const service = createCalculationService(model);
  const raw = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'cars', values: rows })
    .createLinePlot({ id: 'plot', x: 'Weight_in_lbs', y: 'Acceleration', guides: false, line: { strokeWidth: 1 } });
  service.execute({ type: 'state', stateId: 'learned', snapshot: serializeProgram(raw) });
  for (const [searchQuery, method, value] of [['opacity', 'encodeOpacity', .7], ['stroke width', 'encodeStrokeWidth', 2]]) {
    const response = service.execute({ type: 'recommend', stateId: 'learned', group: 'encoding', searchQuery,
      options: { target: 'plot', includeRevisions: true, limit: 100 } });
    const rec = response.result.recommendations.find(r => r.method === method);
    assert.equal(rec.args.value, value);
    assert.equal(rec.parameterValues.mode, 'fixed');
    assert.equal(rec.defaultDecisions.find(d => d.control === 'value').source, 'corpus');
    assert.equal(rec.validation.svgSerialized, true);
  }
});
