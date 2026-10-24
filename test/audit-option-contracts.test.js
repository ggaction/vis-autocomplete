import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createRecommendationEngine } from '../src/engine.js';
import { profileDataset } from '../src/profile.js';
import { defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';
import { generateCandidates } from '../src/catalog.js';
import { recommendationParameters, valuesFor, activeControls } from '../web/parameters.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));
const engine = createRecommendationEngine(model);
const data = ['A', 'B', 'C'].flatMap((g, j) => Array.from({ length: 8 }, (_, i) => ({
  g, other: i % 2 ? 'Odd' : 'Even', x: i + 1, y: (i + 1) * (j + 1), z: i + 3,
})));
const base = (rows = data) => chart().createCanvas(defaultCanvasOptions()).createData({ id: 'data', values: rows });
const context = p => { const layer = p.semanticSpec.layers.find(l => l.id === 'plot'); return { layer, profile: profileDataset(p, layer.data) }; };
const editor = (p, method, group) => {
  const rec = engine.recommend(p, { target: 'plot', group, includeRevisions: true, validationMode: 'deferred', limit: 1000 })
    .recommendations.find(rec => rec.method === method);
  assert.ok(rec, `${method} card`);
  return { rec, ed: recommendationParameters({ ...rec, skipParameterDefaults: true }, context(p).profile) };
};
const apply = (p, rec, ed, values) => prepareGuidedAction(p, { method: rec.method, args: ed.build(values) }).authoringPreview;
const set = (ed, values, label, value) => {
  const control = activeControls(ed.resolveControls(values), values).find(c => c.label === label);
  assert.ok(control, label); return { ...values, [control.key]: value };
};

test('Radar facets and series use source observations, never the folded dimension role (U03)', () => {
  const p = base(data.filter((_, i) => i % 8 === 0)).createRadarPlot({ id: 'plot', wide: { fields: ['x', 'y', 'z'] }, groupBy: 'g', color: 'g', guides: false });
  const ctx = context(p), all = generateCandidates(p, ctx), folded = ctx.layer.encoding.theta.field;
  assert.ok(all.some(c => c.method === 'facet'));
  for (const rec of all.filter(c => ['facet', 'facetGrid', 'encodeGroup'].includes(c.method))) {
    assert.notEqual(rec.args.field, folded);
    for (const parameter of rec.parameters ?? []) if (parameter.path.includes('field')) assert.ok(!parameter.choices.some(c => c.value === folded));
    assert.doesNotThrow(() => rec.method === 'encodeGroup' ? p.encodeGroup(rec.args)
      : prepareGuidedAction(p, { method: rec.method, args: rec.args }), `${rec.method}/${rec.args.field}`);
  }
});

test('Box statistic and appearance recipes expose meaningful editable native fields (U04)', () => {
  const p = base().createBoxPlot({ id: 'plot', x: { field: 'g', fieldType: 'nominal' }, y: { field: 'y' } });
  for (const group of ['transform', 'style']) {
    const { rec, ed } = editor(p, 'editBoxPlot', group), initial = valuesFor(ed.controls);
    assert.ok(!ed.controls.some(control => control.key === 'variant'));
    assert.equal(ed.controls.length, 4);
    if (group === 'transform') {
      let values = set(ed, initial, 'Whiskers', 'minmax');
      assert.equal(ed.build(values).whisker.factor, undefined);
      assert.equal(apply(p, rec, ed, values).markConfigs.plot.boxPlot.whisker.type, 'minmax');
      values = set(ed, initial, 'Whiskers', 'tukey');
      values = set(ed, values, 'IQR factor', 3);
      values = set(ed, values, 'Outliers', false);
      const q = apply(p, rec, ed, values);
      assert.equal(q.markConfigs.plot.boxPlot.whisker.factor, 3);
      assert.equal(q.markConfigs.plot.boxPlot.outliers, false);
    } else {
      const values = set(ed, initial, 'Median line width', 4);
      assert.equal(apply(p, rec, ed, values).markConfigs.plot.boxPlot.median.strokeWidth, 4);
    }
  }
});

test('Continuous color exposes direction, valid transforms, custom domain and center (U05)', () => {
  const p = base(data.filter((_, i) => i % 8 === 0)).createHeatmap({ id: 'plot', x: 'g', y: 'other', color: { field: 'y', fieldType: 'quantitative' } });
  const { rec, ed } = editor(p, 'editColorScale', 'encoding'), initial = valuesFor(ed.controls);
  assert.equal(ed.controls.length, 4);
  const scaleId = context(p).layer.encoding.color.scale;
  for (const scaleType of ['sequential', 'sqrt', 'symlog']) {
    const q = apply(p, rec, ed, { ...initial, scaleType, reverse: true });
    const scale = q.semanticSpec.scales.find(scale => scale.id === scaleId);
    assert.equal(scale.type, scaleType); assert.equal(scale.reverse, true);
  }
  const q = apply(p, rec, ed, { ...initial, domainMode: 'custom', domainMin: -1, domainMax: 5, centerMode: 'custom', midpoint: 4 });
  assert.equal(q.semanticSpec.scales.find(scale => scale.id === scaleId).midpoint, 4);
  assert.deepEqual(q.semanticSpec.scales.find(scale => scale.id === scaleId).domain, [-1, 5]);
});

test('Legend entries can be revealed through one native editLegend call (SD04)', () => {
  const p = base(Array.from({ length: 20 }, (_, i) => ({ x: i, y: i + 1, g: `Group ${i}` })))
    .createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'g', guides: false })
    .createLegend({ target: 'plot', channels: ['color'], position: 'right', overflow: { maxItems: 6 } });
  const { rec, ed } = editor(p, 'editLegend', 'style'), initial = valuesFor(ed.controls);
  const call = ed.build({ ...initial, showAll: true });
  assert.equal(call.overflow, false);
  const q = apply(p, rec, ed, { ...initial, showAll: true });
  assert.ok(Object.values(q.guideConfigs.legend).some(legend => legend.overflow === false));
  const limited = apply(p, rec, ed, { ...initial, showAll: false, maxItems: 10 });
  assert.ok(Object.values(limited.guideConfigs.legend).some(legend => legend.overflow?.maxItems === 10));
});

test('Legend overflow controls follow the selected channel and shared-facet positions stay valid', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'g', guides: false })
    .encodeSize({ target: 'plot', field: 'z', fieldType: 'quantitative' }).createGuides();
  const { rec, ed } = editor(p, 'editLegend', 'style'), initial = valuesFor(ed.controls);
  const values = ed.normalizeValues({ ...initial, channel: 'size' }, 'channel');
  assert.ok(!activeControls(ed.resolveControls(values), values).some(c => c.key === 'showAll'));
  assert.equal(ed.build(values).overflow, undefined);
  assert.ok(apply(p, rec, ed, { ...values, position: 'bottom' }));
  const faceted = p.facet({ field: 'g', columns: 3, guides: { axes: 'outer', legend: 'shared' } });
  const facetEditor = editor(faceted, 'editLegend', 'style').ed;
  const positions = activeControls(facetEditor.resolveControls(valuesFor(facetEditor.controls)), valuesFor(facetEditor.controls))
    .find(c => c.label === 'Position').choices;
  assert.ok(positions.filter(c => c.value.includes('-')).every(c => c.disabled && c.reason));
  assert.ok(positions.filter(c => !c.value.includes('-')).every(c => !c.disabled));
});

test('Regression can select polynomial degree, LOESS span, and prediction intervals before Apply (ROOT02)', () => {
  const p = base().createScatterPlot({ id: 'plot', x: 'x', y: 'y', color: 'g' });
  const { rec, ed } = editor(p, 'createRegression', 'transform'), initial = valuesFor(ed.controls);
  assert.equal(ed.controls.length, 4);
  for (const change of [{ method: 'polynomial', degree: 3, interval: 'prediction', level: .9 },
    { method: 'loess', span: .75, robustIterations: 2 }, { method: 'linear', interval: false }]) {
    const args = ed.build({ ...initial, ...change });
    for (const [key, value] of Object.entries(change)) assert.equal(args[key], value);
    assert.ok(apply(p, rec, ed, { ...initial, ...change }));
  }
});

test('Aggregate axis values and original observations have distinct labels and computed statistics (ROOT03)', () => {
  const p = base().createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'sum' } });
  const { rec, ed } = editor(p, 'createStatisticalReference', 'transform'), initial = { ...valuesFor(ed.controls), axis: 'y' };
  const controls = ed.resolveControls(initial), populations = controls.find(control => control.key === 'population').choices;
  assert.match(populations.find(p => p.value === 'boundData').label, /Aggregated.*3/);
  assert.match(populations.find(p => p.value === 'observations').label, /Original.*24/);
  const value = population => {
    const q = apply(p, rec, ed, { ...initial, population, statistic: 'mean', groupBy: '' });
    const config = q.markConfigs.statisticalReference.statisticalReference;
    return q.semanticSpec.datasets.find(d => d.id === config.dataId).values[0].value;
  };
  assert.equal(value('boundData'), 72);
  assert.equal(value('observations'), 9);
});

test('Derived Y statistics omit unavailable original groups while X retains them (SD-X01)', () => {
  for (const [method, args] of [['createECDFPlot', { field: 'x', groupBy: 'g' }], ['createDensityPlot', { field: 'x' }],
    ['createIntervalPlot', { x: 'g', y: 'y' }]]) {
    const p = base()[method]({ id: 'plot', ...args, guides: false });
    const { rec, ed } = editor(p, 'createStatisticalReference', 'transform'), initial = valuesFor(ed.controls);
    const values = ed.normalizeValues({ ...initial, axis: 'y', population: 'boundData', groupBy: 'other' }, 'axis');
    assert.equal(values.groupBy, '');
    assert.ok(!ed.resolveControls(values).find(c => c.key === 'groupBy').choices.some(c => c.value === 'other'));
    assert.ok(apply(p, rec, ed, values));
    if (method !== 'createIntervalPlot') {
      const x = ed.normalizeValues({ ...initial, axis: 'x', groupBy: 'other', population: 'boundData' }, 'axis');
      assert.equal(x.groupBy, 'other'); assert.ok(apply(p, rec, ed, x));
    }
  }
});

test('Signed bar layouts expose Diverging while explaining unavailable positive-only layouts (COMP07)', () => {
  const p = base(data.map((row, i) => ({ ...row, y: i % 2 ? -row.y : row.y })))
    .createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'sum' }, color: { field: 'other', layout: 'group' } });
  const { rec, ed } = editor(p, 'layoutSeries', 'transform'), initial = valuesFor(ed.controls);
  const control = ed.controls.find(c => c.label === 'Layout');
  assert.ok(control.choices.find(c => c.value === 'diverging' && !c.disabled));
  for (const mode of ['stack', 'fill']) assert.ok(control.choices.find(c => c.value === mode).disabled);
  const q = apply(p, rec, ed, { ...initial, [control.key]: 'diverging' });
  assert.equal(context(q).layer.layout.mode, 'diverging');
});
