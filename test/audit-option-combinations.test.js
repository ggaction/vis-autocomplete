import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { profileDataset } from '../src/profile.js';
import { generateCandidates } from '../src/catalog.js';
import { facetCandidates } from '../src/facet-candidates.js';
import { appearanceCandidates } from '../src/appearance-candidates.js';
import { selectionAxes } from '../web/selection-setup.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { createRecommendationEngine } from '../src/engine.js';
import { positionScaleContext } from '../src/mark-grain.js';

const read = name => JSON.parse(readFileSync(new URL(`../web/data/${name}.json`, import.meta.url)));
const base = rows => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const context = p => {
  const layer = p.semanticSpec.layers.find(layer => layer.id === 'plot') ?? p.semanticSpec.layers[0];
  return { layer, profile: profileDataset(p, layer.data) };
};
function replay(p, result) {
  for (const call of [...result.prerequisiteCalls, result.recommendation, ...result.postActionCalls, result.guideCall]) p = p[call.method](call.args);
  assert.deepEqual(p.graphicSpec, result.preview.graphicSpec);
  assert.deepEqual(deserializeProgram(serializeProgram(p)).graphicSpec, p.graphicSpec);
  return p;
}

test('nullable histogram remapping and dense bins retain every valid observation with replayable guides', () => {
  const cars = read('cars').filter(row => row.Miles_per_Gallon != null);
  const p = base(cars).createHistogram({ id: 'plot', field: 'Miles_per_Gallon' });
  const result = prepareGuidedAction(p, { method: 'encodeX', args: {
    target: 'plot', field: 'Horsepower', fieldType: 'quantitative', bin: { maxBins: 40 } } });
  const q = replay(p, result);
  assert.equal(q.semanticSpec.datasets[0].values.length, cars.length);
  assert.equal(q.semanticSpec.layers[0].mark.missing, 'skip');
  const labels = prepareGuidedAction(q, { method: 'createMarkLabels', args: { source: 'plot', content: 'category' } });
  assert.match(renderToSVG(labels.preview), /–/);
});

test('long numeric columns remain selectable without silently changing their schema to dates', () => {
  const rows = [{ Year: 946684800000, value: 1 }, { Year: 978307200000, value: 2 },
    { Year: 1009843200000, value: 3 }, { Year: 1041379200000, value: 4 }];
  const p = base(rows), result = selectionAxes(p, profileDataset(p, 'data'), rows, { x: 'Year', y: 'value' });
  assert.equal(result.program.semanticSpec.scales.find(scale => scale.id === 'selection-x').type, 'linear');
  assert.ok(renderToSVG(result.program).length > 1000);
  assert.deepEqual(result.calls.reduce((p, call) => p[call.method](call.args), p).graphicSpec, result.program.graphicSpec);
});

test('Log choices account for bin boundaries on current and newly binned variables', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ X: i + 1, Y: 1.2 + i * 20, Group: i % 2 ? 'A' : 'B' }));
  for (const p of [
    base(rows).createHistogram({ id: 'plot', field: 'X' }),
    base(rows).createLinePlot({ id: 'plot', x: { field: 'Group', fieldType: 'nominal' }, y: { field: 'Y', aggregate: 'mean' } }),
  ]) {
    const ctx = context(p), scaleContext = positionScaleContext(p, ctx.layer, ctx.profile);
    assert.ok(scaleContext.nonPositiveBins.x.includes('Y'));
    const rec = generateCandidates(p, ctx).find(c => c.method === 'encodeX' && c.args.field === 'Y');
    assert.ok(rec);
    const editor = recommendationParameters({ ...rec, alternatives: [rec], positionScaleContext: scaleContext }, ctx.profile);
    const controls = editor.resolveControls({ ...valuesFor(editor.controls), field: 'Y' });
    assert.equal(controls.find(c => c.key === 'scale').choices.find(c => c.value === 'log').disabled, true);
    assert.equal(controls.find(c => c.key === 'scale').choices.find(c => c.value === 'symlog').disabled, false);
  }
});

test('polar facet guide fitting includes retained axes in the final spacing calculation', () => {
  const p = prepareGuidedAction(base(read('barley')), { method: 'createRosePlot',
    args: { id: 'plot', category: 'variety', value: 'yield', color: 'variety' } }).preview;
  const result = prepareGuidedAction(p, { method: 'facet', args: { field: 'year', columns: 3,
    spacing: 'plot', gap: 12, guides: { axes: 'each', legend: 'shared' } } });
  const q = replay(p, result);
  assert.equal(Object.keys(q.children).length, 2);
  assert.ok(Object.values(q.children).every(child => child.semanticSpec.guides.axis.radius));
});

test('aggregate polar axis editing preserves the requested label size while fitting radial ticks', () => {
  const rows = read('electricity').map(row => ({ ...row, net_generation: Number(row.net_generation) }));
  const initial = prepareGuidedAction(base(rows), { method: 'createRadialBarPlot',
    args: { id: 'plot', category: 'source', value: 'net_generation', color: 'source' } });
  const axes = { theta: { ticksAndLabels: { labels: { fontSize: 18 } } },
    radius: { ticksAndLabels: { labels: { fontSize: 18 } } } };
  const result = prepareGuidedAction(initial.authoringPreview, { method: 'editAxes', args: axes }, initial.preview);
  const q = replay(initial.authoringPreview, result);
  assert.equal(q.guideConfigs.axis.radius.labels.fontSize, 18);
  assert.equal(q.guideConfigs.axis.theta.labels.fontSize, 18);
});

test('facet independent color and regression do not fail the whole option because of shared legend policy', () => {
  const p = base(read('iris')).createScatterPlot({ id: 'plot', x: 'Sepal.Length', y: 'Petal.Length', color: 'Species' });
  const f = prepareGuidedAction(p, { method: 'facet', args: { field: 'Species', columns: 3,
    spacing: 'plot', gap: 12, guides: { axes: 'outer', legend: 'shared' } } });
  for (const action of [
    { method: 'editFacetScales', args: { color: 'independent' } },
    { method: 'editFacetSource', args: { action: { method: 'encodeColor', options: { target: 'plot', value: '#e45756' } } } },
    { method: 'editFacetSource', args: { action: { method: 'createRegression', options: { target: 'plot', method: 'linear', groupBy: 'Species' } } } },
  ]) {
    const result = prepareGuidedAction(f.authoringPreview, action, f.preview);
    const q = replay(f.authoringPreview, result);
    assert.equal(Object.keys(q.children).length, 3);
    assert.equal(result.recommendation.validation.topLevelActions, 1);
  }
  const cards = facetCandidates(f.preview, context(f.preview));
  const scales = cards.find(card => card.method === 'editFacetScales');
  assert.equal(scales.args.color, 'shared');
  assert.ok(prepareGuidedAction(f.authoringPreview, { method: scales.method, args: scales.args }, f.preview).preview);
  const guides = cards.find(card => card.method === 'editFacetGuides');
  assert.ok(guides.parameters.find(parameter => parameter.path === 'legend').choices.some(choice => choice.value?.position === 'bottom'));
});

test('repeated statistics and annotations create new resources and stay searchable', () => {
  const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
  let p = base(read('iris')).createScatterPlot({ id: 'plot', x: 'Sepal.Length', y: 'Petal.Length' });
  for (const method of ['createStatisticalReference', 'createAnnotation']) {
    for (let index = 0; index < 2; index++) {
      const candidates = generateCandidates(p, context(p));
      const candidate = candidates.find(card => card.method === method);
      assert.ok(candidate, `${method} after ${index} prior creation`);
      const editor = recommendationParameters({ ...candidate, alternatives: [candidate] }, context(p).profile);
      const args = editor.build(valuesFor(editor.controls));
      if (method === 'createStatisticalReference' && index === 1) args.axis = 'y';
      p = prepareGuidedAction(p, { method, args }).authoringPreview;
    }
    assert.equal(method === 'createStatisticalReference'
      ? Object.values(p.markConfigs).filter(config => config.statisticalReference).length
      : p.semanticSpec.layers.filter(layer => /^annotation\d*$/.test(layer.id) && layer.mark.type === 'text').length, 2);
  }
  const found = createRecommendationEngine(model).rank(p, { target: 'plot', limit: 100, group: 'transform', includeRevisions: true, deprioritizeAppliedActions: true })
    .recommendations.find(card => card.method === 'createStatisticalReference');
  assert.ok(found);
  assert.equal(found.previouslyApplied, true);
});

test('sector stroke fields respect the same displayed grain as sector color', () => {
  const p = base(read('tips')).createPiePlot({ id: 'plot', category: 'day', value: 'total_bill' });
  const cards = appearanceCandidates(p, context(p));
  assert.ok(cards.some(card => card.method === 'encodeStroke' && card.args.field === 'day'));
  assert.ok(!cards.some(card => card.method === 'encodeStroke' && card.args.field === 'sex'));
  assert.ok(cards.some(card => card.method === 'encodeStroke' && card.args.value));
});

test('corpus recipes cannot create duplicate or incompatible generic mark editors', () => {
  const p = base(read('iris')).createScatterPlot({ id: 'plot', x: 'Sepal.Length', y: 'Petal.Length' });
  const candidates = generateCandidates(p, { ...context(p), actionEvidence: {
    methods: [{ public: true, method: 'editPointMark', templates: [{ args: { opacity: .5 } }] }] } });
  assert.equal(candidates.filter(card => card.method === 'editPointMark').length, 1);
  assert.ok(candidates.find(card => card.method === 'editPointMark').parameters.length > 0);
});
