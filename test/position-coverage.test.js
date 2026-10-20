import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { actionFeatures, extractFeatures, PLOT_MARKS } from '../src/semantics.js';
import { INITIAL_PLOT_METHODS } from '../src/plot-catalog.js';
import { createCalculationService } from '../web/calculation-service.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const rows = Array.from({ length: 12 }, (_, i) => ({ X: i + 1, Y: i * 3 + 2, Z: i % 5 + 1, Negative: i - 6,
  Group: ['A', 'B', 'C'][i % 3], Alias: ['East', 'West', 'North'][i % 3] }));
const base = () => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const recipes = p => generateCandidates(p, { layer: p.semanticSpec.layers.find(l => l.id === 'plot'), profile: profileDataset(p, p.semanticSpec.layers.find(l => l.id === 'plot').data) });
function request(p, method, group = 'encoding') {
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 1, snapshot: serializeProgram(p) });
  let response;
  for (let page = 0; ; page++) {
    response = service.execute({ type: 'recommend', stateId: 1, group, page, searchQuery: method, options: { target: 'plot', ...FOLLOWUP_RECOMMENDATION_OPTIONS } });
    if (response.pagination.complete) return response;
  }
}

test('training, semantic state and applied channels share radial and glyph-size identities', () => {
  assert.deepEqual(new Set(Object.keys(PLOT_MARKS)), new Set(INITIAL_PLOT_METHODS));
  const p = base().createRosePlot({ id: 'plot', category: 'Group', value: 'Y', guides: false });
  const features = extractFeatures(p, { target: 'plot' });
  for (const f of ['mark.arc', 'encoding.r', 'encoding.theta']) {
    assert.ok(features.includes(f)); assert.ok(actionFeatures('createRosePlot', { category: 'Group', value: 'Y' }).includes(f));
    assert.ok(model.featureCounts[f] > 0, f);
  }
  assert.ok(!features.includes('encoding.radius'));
  assert.deepEqual(actionFeatures('encodeR', { field: 'Y' }), ['encoding.r']);
  assert.deepEqual(actionFeatures('encodeRadius', { value: 4 }), ['encoding.size']);
  assert.ok(actionFeatures('encodeChannels', { r: { field: 'Y' } }).includes('encoding.r'));
  const r = request(p, 'encodeR').result.recommendations.find(r => r.method === 'encodeR');
  assert.ok(r); assert.equal(r.previouslyApplied, true, 'existing radius goes to the back rather than disappearing');
});

test('rose and radial bars offer sum/count and area/length via one native radius action', () => {
  for (const method of ['createRosePlot', 'createRadialBarPlot']) {
    const p = base()[method]({ id: 'plot', category: 'Group', value: 'Y', guides: false });
    const rec = request(p, 'encodeR').result.recommendations.find(r => r.method === 'encodeR');
    assert.ok(rec, method);
    const editor = recommendationParameters(rec, profileDataset(p, 'data'));
    assert.ok(editor.controls.length <= 3);
    for (const aggregate of ['sum', 'count']) for (const mapping of ['area', 'radius-length']) {
      const args = editor.build({ ...valuesFor(editor.controls), field: 'Z', aggregate, mapping });
      const next = p.encodeR(args);
      assert.equal(next.trace.children.length, p.trace.children.length + 1);
      assert.equal(next.semanticSpec.layers.find(l => l.id === 'plot').encoding.radius.aggregate, aggregate);
      assert.equal(Object.hasOwn(args, 'field'), aggregate !== 'count');
      assert.match(renderToSVG(next), /<svg/);
    }
    const scale = request(p, 'editRScale', 'style').result.recommendations.find(r => r.method === 'editRScale');
    assert.ok(scale); assert.equal(scale.args.range, undefined);
    assert.ok(['area', 'radius-length'].includes(scale.args.radialMapping));
    assert.ok(!recipes(p).find(r => r.method === 'editArcMark').parameters.some(p => p.path === 'padAngle'));
  }
});

test('count-only rose plots keep radius mapping available without a numeric field', () => {
  const p = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: [{ Group: 'A' }, { Group: 'A' }, { Group: 'B' }] })
    .createRosePlot({ id: 'plot', category: 'Group', aggregate: 'count', guides: false });
  const rec = request(p, 'encodeR').result.recommendations.find(r => r.method === 'encodeR');
  assert.ok(rec);
  const editor = recommendationParameters(rec, profileDataset(p, 'data'));
  assert.equal(editor.controls.find(c => c.key === 'aggregate').choices.find(c => c.value === 'sum').disabled, true);
  assert.equal(rec.args.aggregate, 'count');
  assert.equal(rec.args.mapping, 'radius-length');
  assert.match(renderToSVG(p.encodeR(editor.build(valuesFor(editor.controls)))), /<svg/);
});

test('polar variables accept categorical angle and negative numeric radius when native geometry supports them', () => {
  const p = base().createPolarScatterPlot({ id: 'plot', theta: 'X', radius: 'Y', guides: false });
  for (const [method, field] of [['encodeTheta', 'Alias'], ['encodeR', 'Negative']]) {
    const rec = request(p, method).result.recommendations.find(r => r.method === method);
    assert.ok(rec?.alternatives.some(a => a.args.field === field), method);
    const editor = recommendationParameters(rec, profileDataset(p, 'data'));
    const args = editor.build({ ...valuesFor(editor.controls), field });
    assert.match(renderToSVG(p[method](args)), /<svg/);
  }
  const p2 = base().createRosePlot({ id: 'plot', category: 'Group', value: 'Y', color: false, guides: false });
  const theta = request(p2, 'encodeTheta').result.recommendations.find(r => r.method === 'encodeTheta');
  assert.ok(theta?.alternatives.some(a => a.args.field === 'Alias'));
  assert.ok(recipes(p2).some(r => r.method === 'encodeColor' && r.args.field === 'Alias'), 'sector-constant colors need not have the same column name');
});

test('text, rug, ranged area and rectangles retain valid position changes', () => {
  for (const [p, methods] of [
    [base().createTextPlot({ id: 'plot', x: 'X', y: 'Y', text: 'Group', guides: false }), ['encodeX', 'encodeY']],
    [base().createRugPlot({ id: 'plot', x: 'X', edge: 'bottom', guides: false }), ['encodeX']],
    [base().createAreaPlot({ id: 'plot', x: 'X', y: 'Y', guides: false }), ['encodeY2']],
    [base().createRectMark({ id: 'plot' }).encodeX({ field: 'X' }).encodeX2({ field: 'Z' }).encodeY({ field: 'Y' }).encodeY2({ datum: 0 }), ['encodeX', 'encodeX2', 'encodeY', 'encodeY2']],
  ]) for (const method of methods) {
    const rec = request(p, method).result.recommendations.find(r => r.method === method);
    assert.ok(rec, method);
    assert.match(renderToSVG(p[method](rec.args)), /<svg/);
  }
});

test('derived chart roles edit original variables through native facade/data owners', () => {
  for (const [plot, options, expected] of [
    ['createViolinPlot', { x: { field: 'Group', fieldType: 'nominal' }, y: 'Y' }, 'editViolinPlot'],
    ['createGradientPlot', { x: { field: 'Group', fieldType: 'nominal' }, y: 'Y' }, 'editGradientPlot'],
    ['createDotPlot', { category: 'Group', value: 'Y', summary: 'mean' }, 'editEndpointPlot'],
    ['createLollipopPlot', { category: 'Group', value: 'Y', summary: 'mean' }, 'editEndpointPlot'],
    ['createDumbbellPlot', { category: 'Group', start: 'Y', end: 'Z', summary: 'mean' }, 'editEndpointPlot'],
    ['createECDFPlot', { field: 'X' }, 'editECDFPlot'],
  ]) {
    const p = base()[plot]({ id: 'plot', ...options });
    const rec = request(p, expected).result.recommendations.find(r => r.method === expected);
    assert.ok(rec, plot);
    const profile = profileDataset(p, p.semanticSpec.layers.find(l => l.id === 'plot').data);
    const editor = recommendationParameters(rec, profile), values = valuesFor(editor.controls);
    const field = editor.controls.find(c => c.choices?.some(o => o.value === 'Z'));
    assert.ok(field, plot);
    const args = editor.build({ ...values, [field.key]: 'Z' });
    assert.match(renderToSVG(p[expected](args)), /<svg/);
    assert.equal(p[expected](args).trace.children.length, p.trace.children.length + 1);
  }
});

test('line and area statistics use a valid row population, and parallel dimensions remain editable', () => {
  for (const method of ['createLinePlot', 'createAreaPlot']) {
    const p = base()[method]({ id: 'plot', x: 'X', y: 'Y', guides: false });
    const rec = request(p, 'createStatisticalReference', 'transform').result.recommendations.find(r => r.method === 'createStatisticalReference');
    assert.ok(rec, method); assert.equal(rec.args.population, 'boundData');
  }
  const p = base().createParallelCoordinates({ id: 'plot', dimensions: ['X', 'Y'], guides: false });
  const rec = request(p, 'encodeParallelCoordinates').result.recommendations.find(r => r.method === 'encodeParallelCoordinates');
  assert.ok(rec); assert.ok(rec.parameters[0].choices.some(c => c.value === 'Z'));
});

test('regression and interval edits update the complete native owner', () => {
  const regression = base().createRegressionPlot({ id: 'plot', x: 'X', y: 'Y' });
  const fit = request(regression, 'encodeX').result.recommendations.find(r => r.method === 'encodeX');
  assert.ok(fit);
  const fitEditor = recommendationParameters(fit, profileDataset(regression, 'data'));
  const prepared = prepareGuidedAction(regression, { method: 'encodeX', args: fitEditor.build({ ...valuesFor(fitEditor.controls), field: 'Z' }) });
  const next = prepared.authoringPreview;
  assert.deepEqual(prepared.prerequisiteCalls, [{ method: 'editRegression', args: { target: 'plot', sourceBinding: 'follow' } }]);
  assert.equal(next.markConfigs.plot.regression.x, 'Z');
  assert.equal(next.semanticSpec.layers.find(l => l.id === 'plot').encoding.x.field, 'Z');
  assert.equal(next.semanticSpec.layers.find(l => l.id === next.markConfigs.plot.regression.lineId).encoding.x.field, 'Z');
  assert.match(renderToSVG(next), /<svg/);
  const interval = base().createIntervalPlot({ id: 'plot', x: { field: 'Group', fieldType: 'nominal' }, y: { field: 'Y', extent: 'stdev' } });
  const rec = request(interval, 'editErrorBar').result.recommendations.find(r => r.method === 'editErrorBar');
  assert.ok(rec);
  const editor = recommendationParameters(rec, profileDataset(interval, 'data'));
  const edited = interval.editErrorBar(editor.build({ ...valuesFor(editor.controls), p1: 'Z' }));
  const point = edited.semanticSpec.layers.find(l => l.id === 'plot'), rule = edited.semanticSpec.layers.find(l => l.id === 'plotInterval');
  assert.equal(point.data, rule.data);
  assert.equal(edited.semanticSpec.datasets.find(d => d.id === point.data).transform[0].field, 'Z');
  assert.match(renderToSVG(edited), /<svg/);
});
