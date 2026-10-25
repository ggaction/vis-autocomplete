import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { generateCandidates } from '../src/catalog.js';
import { profileDataset } from '../src/profile.js';
import { primaryChartLayer } from '../src/chart-owner.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';
import { statisticalContext } from '../src/statistical-context.js';
const rows = ['A', 'B', 'C'].flatMap((g, j) => Array.from({ length: 7 }, (_, i) => ({ g, h: i % 2 ? 'odd' : 'even', x: i + 1, y: i * (j + 1) + 3, z: i + 7 })));
const base = () => chart().createCanvas({ plot: { width: 500, height: 400 }, margin: { left: 120, right: 220, top: 80, bottom: 100 } }).createData({ id: 'data', values: rows });
const context = p => { const layer = primaryChartLayer(p); return { layer, profile: profileDataset(p, layer.data) }; };
const recipes = p => generateCandidates(p, context(p));
const editor = (p, method) => { const alternatives = recipes(p).filter(rec => rec.method === method); assert.ok(alternatives.length, method); return recommendationParameters({ ...alternatives[0], alternatives, skipParameterDefaults: true }, context(p).profile); };
const probes = c => c.choices?.filter(choice => !choice.disabled).map(choice => choice.value) ?? (c.type === 'number' ? [c.min, c.max] : [c.value]);

test('coordinate-specific axis editors expose executable dimension and polar controls', () => {
  for (const p of [base().createPolarScatterPlot({ id: 'plot', theta: 'x', radius: 'y', color: 'g' }), base().createParallelCoordinates({ id: 'plot', dimensions: ['x', 'y', 'z'], color: 'g' })]) {
    const methods = p.semanticSpec.layers[0].encoding.parallel ? ['editParallelAxis'] : ['editThetaAxis', 'editRadialAxis', 'editThetaAxisLabels', 'editRadialAxisLabels', 'editThetaAxisTicks', 'editRadialAxisTicks', 'editThetaAxisLine', 'editRadialAxisLine', 'editThetaAxisTitle', 'editRadialAxisTitle'];
    for (const method of methods) {
      const e = editor(p, method), values = valuesFor(e.controls);
      for (const control of e.controls) for (const value of probes(control)) assert.match(renderToSVG(p[method](e.build({ ...values, [control.key]: value }))), /<svg/, `${method}/${control.path}/${value}`);
    }
  }
});

test('parallel axis tick counts follow the selected dimension role in both directions', () => {
  const p = base().createParallelCoordinates({ id: 'plot', dimensions: ['x', { field: 'g', fieldType: 'ordinal' }] });
  const alternatives = recipes(p).filter(rec => rec.method === 'editParallelAxis');
  assert.equal(alternatives.length, 2);
  for (const rec of alternatives) {
    const e = recommendationParameters({ ...rec, alternatives, skipParameterDefaults: true }, context(p).profile);
    const field = e.controls.find(c => c.path === 'field'), count = e.controls.find(c => c.path === 'ticksAndLabels.count');
    for (const selected of ['x', 'g', 'x']) {
      const values = e.normalizeValues({ ...valuesFor(e.controls), [field.key]: selected, [count.key]: 3 }, field.key);
      assert.equal(count.when(values), selected === 'x');
      const args = e.build(values);
      assert.equal(args.ticksAndLabels.count, selected === 'x' ? 3 : undefined);
      const next = p.editParallelAxis(args);
      assert.match(renderToSVG(next), /<svg/);
      if (selected === 'g') assert.deepEqual(next.graphicSpec.objects.parallelAxisLabels.items
        .filter(item => ['A', 'B', 'C'].includes(item.properties.text)).map(item => item.properties.text), ['A', 'B', 'C']);
    }
  }
});

test('shape and stroke-dash scale cards expose distinct native range choices', () => {
  for (const [method, p] of [['editShapeScale', base().createScatterPlot({ id: 'plot', x: 'x', y: 'y', guides: false }).encodeShape({ target: 'plot', field: 'g', fieldType: 'nominal' })], ['editStrokeDashScale', base().createLinePlot({ id: 'plot', x: 'x', y: 'y', color: 'g', guides: false }).encodeStrokeDash({ target: 'plot', field: 'g', fieldType: 'nominal' })]]) {
    const e = editor(p, method), control = e.controls[0]; assert.equal(control.choices.length, 4);
    const outputs = new Set();
    for (const choice of control.choices) {
      const args = e.build({ ...valuesFor(e.controls), [control.key]: choice.value });
      assert.equal(args.reverse, undefined); const q = p[method](args);
      outputs.add(renderToSVG(q));
    }
    assert.equal(outputs.size, 4);
  }
});

test('statistical groups exclude fields belonging only to a disabled materialized population', () => {
  const p = base().createViolinPlot({ id: 'plot', x: 'g', y: 'y', guides: false });
  const ctx = context(p), statistical = statisticalContext(p, ctx.layer);
  const rec = { method: 'createStatisticalReference', args: { id: 'reference', source: 'plot', axis: 'y', population: 'boundData', statistic: { op: 'mean' } }, statisticalContext: statistical, skipParameterDefaults: true };
  const e = recommendationParameters(rec, ctx.profile), values = e.normalizeValues({ ...valuesFor(e.controls), axis: 'y' });
  const groups = e.resolveControls(values).find(c => c.key === 'groupBy').choices;
  assert.ok(groups.some(c => c.value === 'g'));
  assert.ok(!groups.some(c => ['y_value', 'y_density'].includes(c.value)));
  const repaired = e.normalizeValues({ ...values, groupBy: 'y_density' }, 'groupBy');
  assert.equal(repaired.groupBy, '');
});

test('packed and band-jitter axes retain category slots and explain incompatible fields', () => {
  for (const [method, options] of [['createBeeswarmPlot', {}], ['createStripPlot', { jitter: { maxOffset: { band: .2 } } }]]) {
    const p = base()[method]({ id: 'plot', x: 'g', y: 'y', guides: false, ...options });
    const e = editor(p, 'encodeX'), fields = e.controls.find(c => c.key === 'field').choices;
    assert.ok(fields.find(c => c.value === 'x')?.disabled);
    assert.match(fields.find(c => c.value === 'x').reason, /categorical slots/);
    assert.equal(fields.find(c => c.value === 'h')?.disabled, undefined);
    assert.match(renderToSVG(p.encodeX(e.build({ ...valuesFor(e.controls), field: 'h' }))), /<svg/);
  }
});

test('source filter bounds preserve varying observations in every distribution group', () => {
  for (const [method, args] of [['createViolinPlot', { x: 'g', y: 'y' }], ['createRaincloudPlot', { category: 'g', value: 'y' }], ['createDensityPlot', { field: 'y', groupBy: 'g' }], ['createIntervalPlot', { x: 'g', y: { field: 'y', center: 'mean', extent: 'ci' } }]]) {
    const p = base().filterData({ id: 'filtered', source: 'data', field: 'y', noneOf: [null], nulls: 'exclude' })[method]({ id: 'plot', data: 'filtered', ...args, guides: false });
    const e = editor(p, 'editFilteredData');
    for (const op of ['gte', 'lte']) {
      const opControl = e.controls.find(c => c.path === 'predicate.op');
      const v = e.normalizeValues({ ...valuesFor(e.controls), [opControl.key]: op }, opControl.key);
      const threshold = e.resolveControls(v).find(c => c.path === 'predicate.value');
      for (const value of [threshold.min, threshold.max]) assert.match(renderToSVG(p.editFilteredData(e.build({ ...v, [threshold.key]: value }))), /<svg/, `${method}/${op}/${value}`);
    }
  }
});

test('generated titles use original measurement roles across statistical owners', () => {
  for (const [method, args] of [['createViolinPlot', { x: 'g', y: 'y' }], ['createRaincloudPlot', { category: 'g', value: 'y' }], ['createDotPlot', { category: 'g', value: 'y', orientation: 'vertical', summary: 'mean' }]]) {
    const p = base()[method]({ id: 'plot', ...args, guides: false });
    assert.equal(recipes(p).find(c => c.method === 'createTitle').args.text, 'y by g');
  }
});

test('line grouping options preserve path appearance and adequate series size', () => {
  const p = base().createLinePlot({ id: 'plot', x: { field: 'x', fieldType: 'ordinal' }, y: { field: 'y', aggregate: 'mean' }, color: 'g', guides: false });
  const recs = recipes(p).filter(c => c.method === 'encodeGroup');
  assert.ok(recs.some(c => c.args.field === 'g'));
  assert.ok(!recs.some(c => c.args.field === 'h'));
  const horizon = base().createHorizonPlot({ id: 'plot', x: 'x', y: 'y', groupBy: 'g', guides: false });
  assert.ok(!recipes(horizon).some(c => c.method === 'encodeGroup'));
  assert.ok(recipes(horizon).some(c => c.method === 'editHorizon'));
});


test('follow-results overlays retain source title roles and a usable option deck', () => {
  const p = base().createBarPlot({ id: 'plot', x: 'g', y: { field: 'y', aggregate: 'mean' }, guides: false })
    .createOverlay({ id: 'overlay', source: 'plot', type: 'line', basis: 'visibleItems', series: 'source' });
  const layer = p.semanticSpec.layers.find(l => l.id === 'overlay');
  const recs = generateCandidates(p, { layer, profile: profileDataset(p, layer.data) });
  assert.equal(recs.find(c => c.method === 'createTitle').args.text, 'y by g');
});

test('stacked Area grouping explains unaligned grains and keeps valid series available', () => {
  const values = ['A', 'B'].flatMap(g => [1, 2, 3, 4].map(x => ({ g, h: x % 2 ? 'odd' : 'even', x, y: x + 2 })));
  const p = chart().createCanvas().createData({ id: 'data', values }).createAreaPlot({ id: 'plot', x: 'x', y: 'y', groupBy: 'g', layout: 'stack', guides: false });
  const e = editor(p, 'encodeGroup'), c = e.controls.find(c => c.path === 'field');
  assert.equal(c.choices.find(c => c.value === 'g').disabled, undefined);
  assert.equal(c.choices.find(c => c.value === 'h').disabled, true);
  assert.match(c.choices.find(c => c.value === 'h').reason, /aligned row/);
  assert.match(renderToSVG(p.encodeGroup(e.build(valuesFor(e.controls)))), /<svg/);
});


test('generated density and cumulative titles retain statistical axis meaning', () => {
  for (const [method, expected] of [['createDensityPlot', 'Density of y'], ['createECDFPlot', 'Cumulative probability of y']]) {
    const p = base()[method]({ id: 'plot', field: 'y', groupBy: 'g', guides: false });
    assert.equal(recipes(p).find(c => c.method === 'createTitle').args.text, expected);
  }
});

test('numeric aggregate Line position cards preserve exact positions instead of injecting bins',()=>{
  const p=base().createLinePlot({id:'plot',x:{field:'x',fieldType:'quantitative'},y:{field:'y',aggregate:'mean'},guides:false});
  const x=recipes(p).find(rec=>rec.method==='encodeX'&&rec.args.field==='z');
  assert.ok(x);
  assert.equal(x.args.bin,undefined);
  const q=p.encodeX(x.args);
  assert.equal(q.semanticSpec.layers[0].encoding.x.bin,undefined);
  assert.equal(q.semanticSpec.layers[0].encoding.y.aggregate,'mean');
  assert.match(renderToSVG(q),/<svg/);
});
